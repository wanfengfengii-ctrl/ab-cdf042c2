/* 零依赖本地静态服务器（开发/无 Docker 环境用），行为对齐 nginx.conf：
 * - /health 返回 200 ok
 * - 其余请求从 dist/（或 PORT 指定目录）取静态文件，找不到时回退 index.html */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 8080);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  let path = normalize(join(root, url));
  if (!path.startsWith(root)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    const s = await stat(path);
    if (s.isDirectory()) path = join(path, 'index.html');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(root, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(data);
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('站点尚未构建：请先运行 npm run build');
    }
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`静态服务已启动: http://127.0.0.1:${port}/ （健康检查: /health，目录: dist/）`);
});
