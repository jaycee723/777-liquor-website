import firebaseRulesPlugin from "@firebase/eslint-plugin-security-rules";

export default [
  {
    ignores: ["dist/**/*", "node_modules/**/*", "777-Liquor-Website/**/*"],
  },
  firebaseRulesPlugin.configs["flat/recommended"],
];
