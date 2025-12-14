// Production Server for Google Cloud Run
const { spawn } = require('child_process');

// Google Cloud Run uses PORT environment variable
const PORT = process.env.PORT || 8080;
process.env.PORT = PORT;

console.log(`Starting KisanDecks server on port ${PORT}...`);

// Run the built production server
const server = spawn('node', ['dist/index.cjs'], {
  stdio: 'inherit',
  env: { 
    ...process.env, 
    NODE_ENV: 'production', 
    PORT: PORT 
  }
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

server.on('close', (code) => {
  console.log(`Server exited with code ${code}`);
  process.exit(code);
});

// Handle graceful shutdown for Google Cloud Run
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.kill('SIGINT');
});
