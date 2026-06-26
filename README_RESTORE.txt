PHF TrainingHub restore package

Use this package to restore the last working UI before the broken Official UI patch.

Files included:
- app.js
- index.html

Steps:
1. Copy current broken files to backup if possible:
   Copy-Item app.js app.broken-official-ui.js
   Copy-Item index.html index.broken-official-ui.html
2. Copy app.js and index.html from this package into PHF_TrainingHub.
3. Restart npm start.
4. Open http://localhost:3000?admin=1
