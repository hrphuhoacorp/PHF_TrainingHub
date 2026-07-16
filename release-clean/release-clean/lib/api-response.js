'use strict';

const { publicError } = require('./request-guard');

function setApiHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
}

function send(res, status, payload) {
  setApiHeaders(res);
  return res.status(status).json(payload);
}

function sendError(res, error) {
  console.error('[PHF API]', error?.code || error?.name || 'ERROR', error?.message || error);
  const response = publicError(error);
  return send(res, response.status, response.body);
}

function requestBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); }
    catch {
      const error = new Error('Dữ liệu JSON không hợp lệ.');
      error.statusCode = 400;
      error.code = 'JSON_INVALID';
      throw error;
    }
  }
  return req.body;
}

module.exports = { setApiHeaders, send, sendError, requestBody };
