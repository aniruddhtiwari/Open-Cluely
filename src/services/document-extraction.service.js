const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const path = require('path');

const MAX_EXTRACTED_CONTENT_CHARACTERS = 2_000_000;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);

class DocumentExtractionService {
  async extractText({ fileName, extension, buffer }) {
    if (typeof fileName !== 'string' || !fileName.trim()) {
      throw new Error('A valid file name is required');
    }
    if (typeof extension !== 'string' || !extension.trim()) {
      throw new Error('A valid file extension is required');
    }
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('A file buffer is required');
    }

    const normalizedExtension = extension.toLowerCase();
    if (TEXT_EXTENSIONS.has(normalizedExtension)) {
      const content = buffer.toString('utf8');
      return {
        content,
        metadata: {
          extractor: 'utf8',
          originalCharacters: content.length
        }
      };
    }

    if (normalizedExtension === '.pdf') {
      return this.extractPdf(buffer);
    }

    if (normalizedExtension === '.pptx') {
      return this.extractPptx(buffer);
    }

    if (normalizedExtension !== '.docx') throw new Error('Unsupported document type');

    let extracted;
    try {
      extracted = await mammoth.extractRawText({ buffer });
    } catch (_) {
      throw new Error('Unable to extract text from DOCX; the file may be corrupt or unsupported');
    }

    const originalContent = typeof extracted.value === 'string' ? extracted.value : '';
    const content = originalContent
      .replace(/\r\n?/g, '\n')
      .replace(/\0/g, '')
      .trim();

    if (!content) {
      throw new Error('DOCX contains no readable text');
    }
    if (content.length > MAX_EXTRACTED_CONTENT_CHARACTERS) {
      throw new Error('Extracted content exceeds the 2,000,000-character safety limit');
    }

    return {
      content,
      metadata: {
        extractor: 'mammoth-raw-text',
        originalCharacters: originalContent.length
      }
    };
  }

  async extractPdf(buffer) {
    let extracted;
    try {
      extracted = await pdfParse(buffer);
    } catch (error) {
      const message = String(error && error.message || '').toLowerCase();
      const hasEncryptionMarker = buffer.includes(Buffer.from('/Encrypt'));
      if (hasEncryptionMarker || message.includes('password') || message.includes('encrypted')) {
        throw new Error('PDF is encrypted or password-protected and cannot be parsed');
      }
      throw new Error('Unable to extract text from PDF; the file may be corrupt or unsupported');
    }

    const originalContent = typeof extracted.text === 'string' ? extracted.text : '';
    const content = originalContent
      .replace(/\r\n?/g, '\n')
      .replace(/\0/g, '')
      .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
      .trim();

    if (!content) {
      throw new Error('PDF contains no extractable text. OCR support is not enabled yet.');
    }
    if (content.length > MAX_EXTRACTED_CONTENT_CHARACTERS) {
      throw new Error('Extracted content exceeds the 2,000,000-character safety limit');
    }

    return {
      content,
      metadata: {
        extractor: 'pdf-parse',
        originalCharacters: originalContent.length,
        pageCount: Number.isInteger(extracted.numpages) ? extracted.numpages : null
      }
    };
  }

  async extractPptx(buffer) {
    let zip;
    try {
      zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    } catch (_) {
      throw new Error('Unable to extract text from PPTX; the file may be corrupt or invalid');
    }

    try {
      if (!zip.file('[Content_Types].xml') || !zip.file('ppt/presentation.xml')) {
        throw new Error('Invalid PPTX package');
      }

      const slidePaths = await this.getPptxSlidePaths(zip);
      if (!slidePaths.length) throw new Error('PPTX contains no slides');

      const sections = [];
      let hasReadableText = false;
      for (let index = 0; index < slidePaths.length; index += 1) {
        const slidePath = slidePaths[index];
        const slideXml = await this.readPptxXml(zip, slidePath);
        const slideText = this.extractPptxShapeText(slideXml, false);
        const notesPath = await this.getPptxNotesPath(zip, slidePath);
        const notesText = notesPath
          ? this.extractPptxShapeText(await this.readPptxXml(zip, notesPath), true).body
          : '';

        const parts = [`[Slide ${index + 1}]`];
        if (slideText.title) parts.push(slideText.title);
        if (slideText.body) parts.push(slideText.body);
        if (notesText) parts.push(`[Speaker Notes]\n${notesText}`);
        if (slideText.title || slideText.body || notesText) hasReadableText = true;
        sections.push(parts.join('\n'));
      }

      if (!hasReadableText) throw new Error('PPTX contains no readable slide text.');

      const originalContent = sections.join('\n\n');
      const content = originalContent
        .replace(/\r\n?/g, '\n')
        .replace(/\0/g, '')
        .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
        .trim();

      if (content.length > MAX_EXTRACTED_CONTENT_CHARACTERS) {
        throw new Error('Extracted content exceeds the 2,000,000-character safety limit');
      }

      return {
        content,
        metadata: {
          extractor: 'jszip-xmldom-pptx',
          originalCharacters: originalContent.length,
          slideCount: slidePaths.length
        }
      };
    } catch (error) {
      if (error.message === 'PPTX contains no readable slide text.' ||
          error.message === 'Extracted content exceeds the 2,000,000-character safety limit') {
        throw error;
      }
      throw new Error('Unable to extract text from PPTX; the file may be corrupt or invalid');
    }
  }

  parsePptxXml(xml) {
    const errors = [];
    const document = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') errors.push(message);
      }
    }).parseFromString(xml, 'application/xml');
    if (errors.length || document.getElementsByTagName('parsererror').length) {
      throw new Error('Invalid PPTX XML');
    }
    return document;
  }

  async readPptxXml(zip, filePath) {
    const entry = zip.file(filePath);
    if (!entry) throw new Error('Missing PPTX XML part');
    return this.parsePptxXml(await entry.async('string'));
  }

  async getPptxSlidePaths(zip) {
    const presentation = await this.readPptxXml(zip, 'ppt/presentation.xml');
    const relationships = await this.readPptxXml(zip, 'ppt/_rels/presentation.xml.rels');
    const targetsById = new Map();
    Array.from(relationships.getElementsByTagName('Relationship')).forEach(relationship => {
      targetsById.set(relationship.getAttribute('Id'), relationship.getAttribute('Target'));
    });
    return Array.from(presentation.getElementsByTagName('p:sldId')).map(slideId => {
      const target = targetsById.get(slideId.getAttribute('r:id'));
      if (!target) throw new Error('Missing slide relationship');
      return this.resolvePptxPath('ppt/presentation.xml', target);
    });
  }

  async getPptxNotesPath(zip, slidePath) {
    const fileName = path.posix.basename(slidePath);
    const relationshipsPath = `${path.posix.dirname(slidePath)}/_rels/${fileName}.rels`;
    if (!zip.file(relationshipsPath)) return null;
    const relationships = await this.readPptxXml(zip, relationshipsPath);
    const notesRelationship = Array.from(relationships.getElementsByTagName('Relationship'))
      .find(relationship => relationship.getAttribute('Type').endsWith('/notesSlide'));
    return notesRelationship
      ? this.resolvePptxPath(slidePath, notesRelationship.getAttribute('Target'))
      : null;
  }

  resolvePptxPath(sourcePath, target) {
    const resolvedPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), target))
      .replace(/^\/+/, '');
    if (!resolvedPath.startsWith('ppt/')) {
      throw new Error('Invalid PPTX relationship');
    }
    return resolvedPath;
  }

  extractPptxShapeText(xmlDocument, isNotes) {
    const titleParts = [];
    const bodyParts = [];
    const excludedNotesTypes = new Set(['dt', 'ftr', 'hdr', 'sldNum']);

    Array.from(xmlDocument.getElementsByTagName('p:sp')).forEach(shape => {
      const placeholder = shape.getElementsByTagName('p:ph')[0];
      const placeholderType = placeholder ? placeholder.getAttribute('type') : '';
      if (isNotes && excludedNotesTypes.has(placeholderType)) return;

      const paragraphs = Array.from(shape.getElementsByTagName('a:p'))
        .map(paragraph => Array.from(paragraph.getElementsByTagName('a:t'))
          .map(textNode => textNode.textContent || '')
          .join('')
          .trim())
        .filter(Boolean);
      if (!paragraphs.length) return;

      const text = paragraphs.join('\n');
      if (!isNotes && (placeholderType === 'title' || placeholderType === 'ctrTitle')) {
        titleParts.push(text);
      } else {
        bodyParts.push(text);
      }
    });

    return { title: titleParts.join('\n'), body: bodyParts.join('\n') };
  }
}

module.exports = new DocumentExtractionService();
