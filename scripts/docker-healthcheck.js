import http from 'node:http';

const port = process.env.PORT || 3000;
const options = {
  host: '127.0.0.1',
  port: port,
  path: '/health',
  method: 'GET',
  timeout: 2000
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('Health check passed.');
      process.exit(0);
    } else {
      console.error(`Health check failed with status: ${res.statusCode}. Response: ${body}`);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('Health check connection failed:', err.message);
  process.exit(1);
});

req.end();
