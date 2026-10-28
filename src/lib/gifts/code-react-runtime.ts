/**
 * React runtime pieces for `code` gifts (OOP-5688).
 *
 * Kept apart from `code-react.ts` on purpose: that module imports the
 * JSX compiler, and the gift renderer runs in the browser too (the
 * builder's live preview), so the compiler would land in the client
 * bundle. This file has no dependencies and is safe to import from
 * either side.
 */

export const REACT_VERSION = '18.3.1';

export const REACT_UMD_URLS = {
  react: `https://cdn.jsdelivr.net/npm/react@${REACT_VERSION}/umd/react.production.min.js`,
  reactDom: `https://cdn.jsdelivr.net/npm/react-dom@${REACT_VERSION}/umd/react-dom.production.min.js`,
} as const;

/**
 * Mounts the sender's component after their script has run.
 *
 * The component is expected to be named `App` (a top-level `function App`
 * or `const App = ...`). If the sender forgot to give the page a
 * `#root` element, one is created rather than mounting over whatever
 * they wrote.
 */
export const REACT_MOUNT_SCRIPT = `(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;
  var component = typeof App !== 'undefined' ? App : window.App;
  if (typeof component !== 'function') return;
  var el = document.getElementById('root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'root';
    document.body.appendChild(el);
  }
  ReactDOM.createRoot(el).render(React.createElement(component));
})();`;
