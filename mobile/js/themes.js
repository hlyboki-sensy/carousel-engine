// themes.js — дефолтні бренд-теми (інлайн, дослівно з ../../themes/*.json).
// Юзерські теми/палітри додаються з IndexedDB поверх цих (Етап 2).
//
// ВАЖЛИВО (офлайн + не-tainted canvas): десктоп тягнув Playfair з Google Fonts CDN.
// На мобільному покладаємось на СИСТЕМНІ Apple-шрифти (Didot + Helvetica Neue — є і на
// Mac, і на iPhone), тому "links" порожнє: жодного мережевого шрифту в DOM → snapdom
// нічого не фетчить → canvas гарантовано не-tainted. Playfair лишено у стеку лише як
// fallback для не-Apple пристроїв (Android self-host — окремий крок, за потреби).
export const THEMES = {
  hlyboki: {
    name: "hlyboki_sensy",
    format: { w: 1080, h: 1440 },
    fonts: {
      display: '"Didot","Playfair Display","Bodoni 72",Georgia,serif',
      body: '"Helvetica Neue",Arial,sans-serif',
      links: [],
    },
    colors: {
      accent: "#FFD20E",
      photoBg: "#11151a",
      lightBg: "#d7d0c5",
      coverBg: "#cfc9c2",
      textOnDark: "#f4efe7",
      textOnLight: "#2b211b",
      bodyOnLight: "#473b31",
    },
    kicker: "роздуми маркетолога",
    handle: "@hlyboki_sensy",
  },
  noir: {
    name: "noir_grotesk",
    format: { w: 1080, h: 1440 },
    fonts: {
      display: '"Avenir Next","Helvetica Neue",sans-serif',
      body: '"Avenir Next",Arial,sans-serif',
      links: [],
    },
    colors: {
      accent: "#E2533B",
      photoBg: "#0e0e10",
      lightBg: "#ece7df",
      coverBg: "#1a1a1e",
      textOnDark: "#f5f2ec",
      textOnLight: "#1a1a1e",
      bodyOnLight: "#4a4a52",
    },
    kicker: "роздуми маркетолога",
    handle: "@hlyboki_sensy",
  },
};

export const DEFAULT_THEME = "hlyboki";
