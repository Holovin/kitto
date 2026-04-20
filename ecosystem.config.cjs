module.exports = {
  apps: [
    {
      name: 'kitto-openui',
      script: 'backend/dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: 8888,
        LOG_LEVEL: 'info',
      },
      kill_timeout: 12000,
      max_memory_restart: '512M',
      time: true,
      merge_logs: true,
    },
  ],
};
