const mammoth = require('mammoth');

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

    if (normalizedExtension !== '.docx') {
      throw new Error('Unsupported document type');
    }

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
}

module.exports = new DocumentExtractionService();
