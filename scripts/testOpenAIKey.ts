import 'dotenv/config';

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('OPENAI_API_KEY not set in environment');
  process.exit(1);
}

const res = await fetch('https://api.openai.com/v1/models', {
  headers: { Authorization: `Bearer ${key}` },
});

console.log(`HTTP ${res.status} — ${res.status === 200 ? '✓ Key is valid' : '✗ Key rejected'}`);
process.exit(res.status === 200 ? 0 : 1);
