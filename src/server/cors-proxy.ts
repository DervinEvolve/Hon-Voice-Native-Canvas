import 'dotenv/config';
import express from 'express';
import cors from 'cors';
// Reuse the reviewed route rather than maintaining a second arbitrary URL proxy.
import downloadMediaHandler from '../../api/download-image.js';

const app = express();
const port = Number(process.env.PROXY_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid proxy port');
const origins = new Set((process.env.LOCAL_APP_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim()).filter(Boolean));
app.use(cors({
  origin(origin, callback) { callback(null, Boolean(origin && origins.has(origin))); },
  methods: ['GET'], allowedHeaders: ['Authorization'],
}));
app.get('/proxy', (req, res) => downloadMediaHandler(req, res));
app.listen(port, '127.0.0.1', () => {
  console.log(`Media proxy listening on loopback port ${port}`);
});
export default app;
