'use strict';
/**
 * Image storage adapter.
 *
 * Binaries never touch the database — they go to Cloudinary (production) or
 * public/uploads (local dev), and only the resulting URL + metadata are
 * persisted in the Media table.
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');

let cloudinary = null;
function getCloudinary() {
  if (cloudinary) return cloudinary;
  const c = require('cloudinary').v2;
  c.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
  cloudinary = c;
  return cloudinary;
}

function cloudinaryConfigured() {
  return Boolean(
    env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret
  );
}

/** Which driver will actually be used for the next upload. */
function activeDriver() {
  return env.storageDriver === 'cloudinary' && cloudinaryConfigured() ? 'cloudinary' : 'local';
}

const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Identify an upload from its *content*, not the client-declared MIME type
 * (browsers and CLI clients frequently send application/octet-stream, and a
 * declared type is attacker-controlled anyway).
 *
 * @returns {{ok: boolean, mime?: string, reason?: string}}
 */
function sniffImage(buffer, originalname) {
  if (!buffer || buffer.length < 12) return { ok: false, reason: 'File is empty or too small.' };

  const ext = path.extname(originalname || '').toLowerCase();
  if (!EXT_MIME[ext]) {
    return { ok: false, reason: `Unsupported file extension: ${ext || '(none)'}` };
  }

  const b = buffer;
  const hex = b.subarray(0, 12).toString('hex');
  const ascii = b.subarray(0, 512).toString('latin1');

  // JPEG: FF D8 FF
  if (hex.startsWith('ffd8ff')) return { ok: true, mime: 'image/jpeg' };
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (hex.startsWith('89504e470d0a1a0a')) return { ok: true, mime: 'image/png' };
  // GIF: "GIF87a" / "GIF89a"
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return { ok: true, mime: 'image/gif' };
  // WebP: "RIFF" .... "WEBP"
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ok: true, mime: 'image/webp' };
  }
  // AVIF / HEIF: "....ftypavif" (brand at offset 8)
  if (b.subarray(4, 8).toString('latin1') === 'ftyp' && /avif|avis|mif1/.test(b.subarray(8, 16).toString('latin1'))) {
    return { ok: true, mime: 'image/avif' };
  }
  // ICO: 00 00 01 00
  if (hex.startsWith('00000100')) return { ok: true, mime: 'image/x-icon' };
  // SVG is plain XML — no magic number, so match the root element.
  if (ext === '.svg' && /<svg[\s>]/i.test(ascii.replace(/^﻿/, ''))) {
    return { ok: true, mime: 'image/svg+xml' };
  }

  return { ok: false, reason: 'File content is not a recognised image.' };
}

function safeName(original) {
  const ext = path.extname(original || '').toLowerCase().slice(0, 10) || '.bin';
  const base = path
    .basename(original || 'file', ext)
    .replace(/[^a-z0-9-_]+/gi, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '') || 'file';
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${base}${ext}`;
}

/**
 * @param {{buffer: Buffer, originalname: string, mimetype: string, size: number}} file
 * @returns {Promise<{url,publicId,provider,filename,mimeType,size,width,height}>}
 */
async function upload(file) {
  if (activeDriver() === 'cloudinary') {
    const c = getCloudinary();
    const result = await new Promise((resolve, reject) => {
      const stream = c.uploader.upload_stream(
        { folder: env.cloudinary.folder, resource_type: 'image' },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(file.buffer);
    });
    return {
      url: result.secure_url,
      publicId: result.public_id,
      provider: 'cloudinary',
      filename: file.originalname,
      mimeType: file.mimetype,
      size: result.bytes ?? file.size,
      width: result.width ?? null,
      height: result.height ?? null,
    };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = safeName(file.originalname);
  await fs.writeFile(path.join(UPLOAD_DIR, filename), file.buffer);
  return {
    url: `/uploads/${filename}`,
    publicId: filename,
    provider: 'local',
    filename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    width: null,
    height: null,
  };
}

/** Best-effort removal of the stored binary; never throws. */
async function destroy(media) {
  if (!media) return;
  try {
    if (media.provider === 'cloudinary' && media.publicId && cloudinaryConfigured()) {
      await getCloudinary().uploader.destroy(media.publicId);
      return;
    }
    if (media.provider === 'local' && media.publicId) {
      // Guard against path traversal via a tampered publicId.
      const target = path.resolve(UPLOAD_DIR, path.basename(media.publicId));
      if (target.startsWith(path.resolve(UPLOAD_DIR))) await fs.unlink(target);
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('[storage] delete failed:', err.message);
    }
  }
}

module.exports = { upload, destroy, activeDriver, cloudinaryConfigured, sniffImage, EXT_MIME, UPLOAD_DIR };
