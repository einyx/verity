// Abstract artwork for the section list: a few overlapping shapes in the marketing site's brand palette.
// The colours are fixed brand values, so the artwork reads the same in light and dark themes.
function NavArtwork() {
  return (
    <svg viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg" role="presentation">
      <circle cx="170" cy="60" r="56" fill="oklch(92.4147% 0.038804 29.672)" />
      <circle cx="80" cy="120" r="64" fill="oklch(57.5781% 0.212322 32.209)" fillOpacity="0.9" />
      <rect x="120" y="110" width="96" height="60" rx="30" fill="oklch(82.0717% 0.1014 32.063)" />
      <circle cx="40" cy="30" r="10" fill="oklch(21.2518% 0.004762 17.533)" />
    </svg>
  );
}

// eslint-disable-next-line import/no-unused-modules
export default NavArtwork;
