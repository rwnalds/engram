import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs — spread them directly.
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // The new React-Compiler-era react-hooks rules flag idiomatic patterns here —
      // the SSR mount-gate (`useEffect(() => setMounted(true), [])`) and the graph's
      // deliberate imperative ref reads for the d3 render. Keep them as signal, not
      // CI-blocking errors.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      // Stripping a field via a rest sibling (e.g. `const { tokenEnc, ...r } = x`) is
      // intentional, not an unused variable.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
    },
  },
];

export default eslintConfig;
