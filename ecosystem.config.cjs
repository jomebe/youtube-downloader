module.exports = {
  apps: [
    {
      name: "youtube-mp3-converter",
      script: "app.py",
      interpreter: "python3",
      args: "--no-browser",
      env: {
        HOST: "0.0.0.0",
        PORT: "8765",
        DOWNLOAD_TTL_SECONDS: "21600",
        PYTHONUNBUFFERED: "1",
      },
    },
  ],
};
