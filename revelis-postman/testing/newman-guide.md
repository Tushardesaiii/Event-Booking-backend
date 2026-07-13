# Newman & CI/CD Integration Guide

Newman is Postman's CLI runner. It can be integrated into GitHub Actions, GitLab CI, or local pipelines.

## Installation
```bash
npm install -g newman
```

## Local Execution
To execute smoke tests against local server running on port 3000:
```bash
newman run postman/Revelis.postman_collection.json -e postman/Revelis_Local.postman_environment.json
```

## CI/CD Pipeline Integration (GitHub Actions)
```yaml
name: API Smoke Tests
on: [push]
jobs:
  smoke-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      - name: Run local server
        run: |
          npm install
          npm run dev &
          sleep 5
      - name: Run Newman Tests
        run: |
          npx newman run revelis-postman/postman/Revelis.postman_collection.json -e revelis-postman/postman/Revelis_Local.postman_environment.json
```
