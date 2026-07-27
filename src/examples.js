import { EXAMPLE_CATEGORIES, EXAMPLE_DEFINITIONS } from './examples/catalog.js';

// `eager` makes Vite read every .d2 file during the build and compile its text
// into the JavaScript bundle. The gallery therefore needs no runtime fetches,
// while each diagram remains a normal standalone D2 file in the repository.
const modules = import.meta.glob('./examples/*.d2', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const sources = Object.fromEntries(
  Object.entries(modules).map(([path, source]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.d2'.length),
    source,
  ]),
);

export { EXAMPLE_CATEGORIES };

export const EXAMPLES = EXAMPLE_DEFINITIONS.map((example) => {
  const source = sources[example.id];
  if (source == null) throw new Error(`Missing D2 example file: ${example.id}.d2`);
  return { ...example, source };
});

export const exampleById = (id) => EXAMPLES.find((example) => example.id === id);
