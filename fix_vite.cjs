const fs = require('fs');
let code = fs.readFileSync('/app/applet/vite.config.ts', 'utf8');

code = code.replace(
  'plugins: [react(), tailwindcss()],',
  'plugins: [react(), tailwindcss()], build: { assetsInlineLimit: 0 },'
);

fs.writeFileSync('/app/applet/vite.config.ts', code);
