const { readData, saveData } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const data = await readData();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const payload = req.body || {};
      const result = await saveData(payload);
      return res.status(200).json(result);
    }

    res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
