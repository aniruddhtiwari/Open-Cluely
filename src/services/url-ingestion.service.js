const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const cheerio = require('cheerio');

const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 2000000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class UrlIngestionService {
  constructor({ lookup = dns.lookup, httpRequest = http.request, httpsRequest = https.request } = {}) {
    this.lookup = lookup;
    this.httpRequest = httpRequest;
    this.httpsRequest = httpsRequest;
  }

  async ingest(rawUrl) {
    const startedAt = Date.now();
    const response = await this.fetchPublicText(rawUrl, 0, startedAt + REQUEST_TIMEOUT_MS);
    const extraction = response.contentType === 'text/html'
      ? this.extractHtml(response.body, response.url)
      : this.extractPlainText(response.body, response.url);

    if (!extraction.content) {
      throw new Error('The webpage did not contain readable text');
    }
    if (extraction.content.length > MAX_EXTRACTED_CHARACTERS) {
      throw new Error('Extracted webpage text exceeds the 2,000,000 character limit');
    }

    return {
      name: extraction.name,
      extension: '.url',
      sizeBytes: response.sizeBytes,
      content: extraction.content,
      metadata: {
        hostname: response.url.hostname,
        statusCode: response.statusCode,
        downloadedBytes: response.sizeBytes,
        extractedCharacters: extraction.content.length,
        elapsedMs: Date.now() - startedAt
      }
    };
  }

  async fetchPublicText(rawUrl, redirectCount = 0, deadline = Date.now() + REQUEST_TIMEOUT_MS) {
    const target = await this.validateAndResolve(rawUrl, deadline);
    const response = await this.request(target, deadline);

    if (REDIRECT_STATUSES.has(response.statusCode)) {
      if (redirectCount >= MAX_REDIRECTS) throw new Error('Too many webpage redirects');
      if (!response.location) throw new Error('Webpage redirect is missing a destination');
      return this.fetchPublicText(
        new URL(response.location, target.url).toString(),
        redirectCount + 1,
        deadline
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Webpage request failed with HTTP ${response.statusCode}`);
    }

    const contentType = this.normalizeContentType(response.contentType);
    if (contentType !== 'text/html' && contentType !== 'text/plain') {
      throw new Error('This URL is not an HTML or text page. Upload linked files with the document uploader');
    }

    return {
      ...response,
      url: target.url,
      contentType
    };
  }

  async validateAndResolve(rawUrl, deadline = Date.now() + REQUEST_TIMEOUT_MS) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch (_) {
      throw new Error('Enter a valid public HTTP or HTTPS URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only public HTTP and HTTPS URLs are supported');
    }
    if (url.username || url.password) {
      throw new Error('URLs containing credentials are not supported');
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new Error('Local and private URLs are not supported');
    }

    if (net.isIP(hostname)) {
      if (!this.isPublicIp(hostname)) throw new Error('Local and private URLs are not supported');
      return { url, address: hostname, family: net.isIP(hostname) };
    }

    if (!hostname.includes('.') || !/^[a-z0-9.-]+$/i.test(hostname)) {
      throw new Error('Enter a valid public hostname');
    }

    let addresses;
    try {
      addresses = await this.withDeadline(
        this.lookup(hostname, { all: true, verbatim: true }),
        deadline
      );
    } catch (error) {
      if (error && /timed out/.test(error.message)) throw error;
      throw new Error('Unable to resolve the webpage hostname');
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new Error('Unable to resolve the webpage hostname');
    }
    if (addresses.some(entry => !entry || !this.isPublicIp(entry.address))) {
      throw new Error('Local and private URLs are not supported');
    }

    return { url, address: addresses[0].address, family: addresses[0].family };
  }

  isPublicIp(address) {
    const family = net.isIP(address);
    if (family === 4) {
      const parts = address.split('.').map(Number);
      const [a, b] = parts;
      return !(
        a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
      );
    }
    if (family === 6) {
      const normalized = address.toLowerCase().split('%')[0];
      const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (mappedIpv4) return this.isPublicIp(mappedIpv4[1]);
      return !(
        normalized === '::' || normalized === '::1' ||
        normalized.startsWith('::ffff:') ||
        normalized.startsWith('fc') || normalized.startsWith('fd') ||
        /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')
      );
    }
    return false;
  }

  request(target, deadline = Date.now() + REQUEST_TIMEOUT_MS) {
    const requestFn = target.url.protocol === 'https:' ? this.httpsRequest : this.httpRequest;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      let request;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      timer = setTimeout(() => {
        if (request) request.destroy();
        finish(reject, new Error('Webpage request timed out after 10 seconds'));
      }, this.remainingTime(deadline));
      request = requestFn({
        protocol: target.url.protocol,
        hostname: target.url.hostname,
        port: target.url.port || undefined,
        path: `${target.url.pathname}${target.url.search}`,
        method: 'GET',
        autoSelectFamily: false,
        headers: {
          Accept: 'text/html,text/plain;q=0.9',
          'Accept-Encoding': 'identity',
          'User-Agent': 'OpenCluely/1.0 (+public webpage context)'
        },
        lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
        servername: target.url.protocol === 'https:' ? target.url.hostname : undefined
      }, response => {
        const responseContentType = this.normalizeContentType(response.headers['content-type'] || '');
        if (
          !REDIRECT_STATUSES.has(response.statusCode) &&
          responseContentType !== 'text/html' &&
          responseContentType !== 'text/plain'
        ) {
          response.destroy();
          finish(reject, new Error('This URL is not an HTML or text page. Upload linked files with the document uploader'));
          return;
        }
        const contentLength = Number(response.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
          response.destroy();
          finish(reject, new Error('Webpage exceeds the 5 MB download limit'));
          return;
        }

        const chunks = [];
        let sizeBytes = 0;
        response.on('data', chunk => {
          sizeBytes += chunk.length;
          if (sizeBytes > MAX_RESPONSE_BYTES) {
            response.destroy();
            finish(reject, new Error('Webpage exceeds the 5 MB download limit'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => finish(resolve, {
          statusCode: response.statusCode || 0,
          location: response.headers.location,
          contentType: response.headers['content-type'] || '',
          sizeBytes,
          body: Buffer.concat(chunks).toString('utf8')
        }));
        response.on('error', error => finish(reject, this.toSafeRequestError(error)));
      });

      request.on('error', error => finish(reject, this.toSafeRequestError(error)));
      request.end();
    });
  }

  normalizeContentType(value) {
    return String(value).split(';', 1)[0].trim().toLowerCase();
  }

  remainingTime(deadline) {
    return Math.max(1, deadline - Date.now());
  }

  withDeadline(promise, deadline) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Webpage request timed out after 10 seconds')),
        this.remainingTime(deadline)
      );
      Promise.resolve(promise).then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  extractHtml(html, url) {
    const $ = cheerio.load(html);
    $('script, style, noscript, svg, nav, footer, form, button, iframe, canvas, template').remove();
    const title = this.normalizeInlineText($('title').first().text());
    const root = $('main, article').first().length ? $('main, article').first() : $('body');
    const blocks = [];

    root.find('h1, h2, h3, h4, h5, h6, p, li, table, pre, code').each((_index, element) => {
      const node = $(element);
      if (node.closest('table').length && element.tagName !== 'table') return;
      if (node.closest('li').length && element.tagName !== 'li') return;
      if (node.closest('pre').length && element.tagName === 'code') return;

      if (element.tagName === 'table') {
        const rows = [];
        node.find('tr').each((_rowIndex, row) => {
          const cells = $(row).find('th, td').map((_cellIndex, cell) =>
            this.normalizeInlineText($(cell).text())
          ).get().filter(Boolean);
          if (cells.length) rows.push(cells.join(' | '));
        });
        if (rows.length) blocks.push(rows.join('\n'));
        return;
      }

      const text = element.tagName === 'pre'
        ? this.normalizeText(node.text())
        : this.normalizeInlineText(node.text());
      if (text) blocks.push(text);
    });

    if (blocks.length === 0) {
      const fallbackText = this.normalizeInlineText(root.text());
      if (fallbackText) blocks.push(fallbackText);
    }

    const name = this.createDisplayName(title, url);
    return {
      name,
      content: this.normalizeText(['[Web Page]', title ? `Title: ${title}` : '', ...blocks].filter(Boolean).join('\n\n'))
    };
  }

  extractPlainText(text, url) {
    const content = this.normalizeText(text);
    return {
      name: this.createDisplayName('', url),
      content: content ? `[Web Page]\n\n${content}` : ''
    };
  }

  createDisplayName(title, url) {
    if (title) return title.slice(0, 160);
    let decodedPathname;
    try {
      decodedPathname = decodeURIComponent(url.pathname);
    } catch (_) {
      decodedPathname = url.pathname;
    }
    const pathLabel = decodedPathname.replace(/^\/+|\/+$/g, '');
    return `${url.hostname}${pathLabel ? `/${pathLabel}` : ''}`.slice(0, 160);
  }

  normalizeInlineText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  normalizeText(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  toSafeRequestError(error) {
    if (error && /timed out|5 MB/.test(error.message)) return error;
    return new Error('Unable to fetch the webpage');
  }
}

module.exports = new UrlIngestionService();
module.exports.UrlIngestionService = UrlIngestionService;
module.exports.limits = Object.freeze({
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_EXTRACTED_CHARACTERS,
  MAX_REDIRECTS
});
