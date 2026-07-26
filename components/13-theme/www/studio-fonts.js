// studio-fonts.js — load the Warm Studio four-font system into Home Assistant.
//
// Loaded by HA on every frontend page via configuration.yaml's
// frontend.extra_module_url. Idempotent (no-op if already injected).
//
// Fonts loaded:
//   • Instrument Serif  — display / headlines (italic capable)
//   • Newsreader        — body text (variable opsz, italic capable)
//   • IBM Plex Sans     — captions / labels / buttons
//   • JetBrains Mono    — code / technical
//
// PRIVACY NOTE: this fetches the fonts from Google Fonts, so every page load
// makes a request to fonts.googleapis.com / fonts.gstatic.com. See the
// component README for how to self-host the fonts instead (swap the
// stylesheet href for a local /local/fonts/ CSS file).
//
// To remove: delete the `extra_module_url` line in configuration.yaml and
// restart HA. The theme will fall back to the next available font in each
// font-family stack ("Iowan Old Style", Georgia, Helvetica Neue,
// SFMono-Regular) so nothing visibly breaks even if the fonts never load.

(() => {
  if (document.head.querySelector('link[data-studio-fonts]')) return;

  // Preconnect both Google Fonts origins so the CSS + woff2 fetches skip
  // DNS/TLS setup — shaves the flash-of-fallback-font on slow tablets.
  const preconnect1 = document.createElement('link');
  preconnect1.rel = 'preconnect';
  preconnect1.href = 'https://fonts.googleapis.com';
  document.head.appendChild(preconnect1);

  const preconnect2 = document.createElement('link');
  preconnect2.rel = 'preconnect';
  preconnect2.href = 'https://fonts.gstatic.com';
  preconnect2.crossOrigin = '';
  document.head.appendChild(preconnect2);

  // display=swap: render immediately with the fallback font, swap in the
  // webfont when it arrives — never a blank flash of invisible text.
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2' +
    '?family=Instrument+Serif:ital@0;1' +
    '&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400' +
    '&family=IBM+Plex+Sans:wght@400;500;600' +
    '&family=JetBrains+Mono:wght@400;500' +
    '&display=swap';
  link.dataset.studioFonts = '1';
  document.head.appendChild(link);
})();
