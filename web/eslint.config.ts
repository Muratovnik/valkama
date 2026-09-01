import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import js from '@eslint/js'
import vitest from '@vitest/eslint-plugin'
import prettier from 'eslint-config-prettier'
import depend from 'eslint-plugin-depend'
import importX from 'eslint-plugin-import-x'
import jsdoc from 'eslint-plugin-jsdoc'
import oxlint from 'eslint-plugin-oxlint'
import perfectionist from 'eslint-plugin-perfectionist'
import playwright from 'eslint-plugin-playwright'
import security from 'eslint-plugin-security'
import sonarjs from 'eslint-plugin-sonarjs'
import unicorn from 'eslint-plugin-unicorn'
import vue from 'eslint-plugin-vue'
import scopedCss from 'eslint-plugin-vue-scoped-css'
import a11y from 'eslint-plugin-vuejs-accessibility'
import globals from 'globals'
import ts from 'typescript-eslint'

import { componentChannels, templateExpressions, watchSources } from './eslint-restricted-syntax.js'

// `max-lines` stays a warning until package A5 has split the inherited large
// files; making it an error now would block the very commits that shrink them.
//
// The same reading applies to every warning below. A rule this repository agrees
// with but cannot satisfy today is a warning that names its backlog, not a rule
// left out: `npm test` stays green, `npm run lint:js` prints the list, and the
// count in the comment is what the next commit is measured against. A rule with
// nothing to report is an error, because locking in a property that already
// holds costs nobody anything.
/**
 * How the members of an interface or an object type are ordered.
 *
 * Shared by `sort-interfaces` and `sort-object-types` so the two cannot drift:
 * they describe the same thing written two ways, and a repository where the
 * `interface` form and the `type` form sort differently has no rule at all.
 */
const TYPE_MEMBER_ORDER = {
  type: 'natural',
  order: 'asc',
  groups: ['index-signature', 'required-property', 'optional-property', 'method'],
  partitionByNewLine: true,
  partitionByComment: false,
}

/**
 * What each file over the 400-line ceiling owes, pinned at the size it has now.
 *
 * The count excludes comments and blank lines already, so these are code sizes
 * rather than prose. Twelve are single-file components at two to three times the
 * limit, and splitting twelve components at once — moving scoped CSS and
 * rearranging the DOM that the browser, axe and clipping suites all read — is a
 * regression surface no product change is asking for right now.
 *
 * So the rule still holds at 400 everywhere else: a new file over it fails the
 * moment it appears, and nothing here can grow past what it already owes.
 * Removing an entry is the ratchet. Raising a number is not a move.
 */
const LINE_DEBT = {
  'src/shared/i18n/locales/en.ts': 1150,
  'src/shared/i18n/locales/ru.ts': 1149,
  'tests/platformApi.test.ts': 476,
  'tests/uiSystemGuard.test.ts': 480,
  'stylelint-order-preset.js': 416,
  'tests/graphView.test.ts': 406,
}

export default ts.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  ts.configs.recommended,
  vue.configs['flat/recommended'],
  // Reached through vue-eslint-parser, so these are the only rules in the whole
  // stack that see the script block of an .vue file: semgrep does not parse SFCs.
  security.configs.recommended,
  ...a11y.configs['flat/recommended'],
  // A disable comment is a decision, and these rules are what keep it one: an
  // unbounded `/* eslint-disable */` at the top of a file silently opts out of
  // everything added to this config afterwards, which is how a config stops
  // describing a repository.
  comments.recommended,
  // The whole recommended set, not a hand-picked subset. 217 of the plugin's
  // 279 rules, every one of them an error, and they are the closest thing on
  // this stack to a catalogue of how generated code goes wrong: residue nobody
  // removed, a value computed and dropped, an exception caught and ignored, a
  // branch that cannot be reached. Starting from the vendor's own list rather
  // than from a selection means the next release adds its findings here instead
  // of waiting for someone to notice the rule exists.
  sonarjs.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { unicorn, perfectionist, 'import-x': importX, 'vue-scoped-css': scopedCss },
    rules: {
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Wire validators reject control characters on purpose, so the character
      // classes that name them are the contract, not a typo.
      'no-control-regex': 'off',
      // TypeScript resolves globals and DOM types itself; the untyped rule only
      // produces false positives on type-position identifiers here.
      'no-undef': 'off',

      // The security rules that describe something this app cannot do are off,
      // each for a structural reason rather than a count. What stays on found
      // nothing today and is here for the day someone writes it.
      //
      // Every validated string is length-bounded before it is matched, which is
      // the mitigation detect-unsafe-regex cannot see: the contract modules
      // reject over-long input first and only then run an anchored pattern.
      'security/detect-unsafe-regex': 'off',
      // `obj[key]` is how a Record is read, and this app reads Records
      // constantly. The rule flags the syntax, not a reachable injection.
      'security/detect-object-injection': 'off',
      // A browser bundle has no filesystem. Every hit is a Node-side script or
      // a test reading its own fixture by a computed path.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
      // Nothing here compares a secret; the hits are UI values and entity tags.
      'security/detect-possible-timing-attacks': 'off',

      // A nested `<label>` associates its control by the HTML specification,
      // and that is the pattern this app uses, so the rule's default demand for
      // nesting *and* an id would reject every correct form here.
      'vuejs-accessibility/label-has-for': ['error', { required: { some: ['nesting', 'id'] } }],

      // Errors, not warnings: card #305 emptied the backlog these were opened
      // as. Every place they still fire carries a reason at the call site, so a
      // new one is a new decision rather than another entry on a pile.
      'vuejs-accessibility/click-events-have-key-events': 'error',
      'vuejs-accessibility/no-static-element-interactions': 'error',
      'vuejs-accessibility/interactive-supports-focus': 'error',
      'vuejs-accessibility/mouse-events-have-key-events': 'error',
      'vuejs-accessibility/no-autofocus': 'error',

      // ---------------------------------------------------------------- core

      // A template literal is one expression the reader takes in at once;
      // `'a' + x + 'b'` is three, and the seams are where a missing space goes
      // unnoticed. Autofixable, so agreeing with it costs nothing.
      'prefer-template': 'warn',
      // `+value`, `!!value` and `'' + value` are casts written as punctuation.
      // The explicit call says which type was meant, which matters most in the
      // wire contracts, where the wrong one is a silent coercion.
      'no-implicit-coercion': 'error',
      'no-var': 'error',
      '@typescript-eslint/adjacent-overload-signatures': 'error',

      // ------------------------------------------------------------- unicorn

      // Abbreviations, restricted to the five that actually appear in handlers
      // and drift there. The default replacement table is deliberately off:
      // it renames `props`, `params` and `ref`, which are Vue's own vocabulary,
      // and a linter that argues with the framework's API gets disabled whole.
      'unicorn/name-replacements': [
        'error',
        {
          extendDefaultReplacements: false,
          replacements: {
            e: { event: true, error: true },
            evt: { event: true },
            err: { error: true },
            btn: { button: true },
            val: { value: true },
          },
        },
      ],
      'unicorn/catch-error-name': 'error',
      'unicorn/error-message': 'error',
      'unicorn/throw-new-error': 'error',
      'unicorn/prefer-type-error': 'error',
      // `catch {}` when the binding is unused, so an empty binding cannot be
      // mistaken for a swallowed value someone meant to inspect.
      'unicorn/prefer-optional-catch-binding': 'error',

      // Browser APIs where the modern spelling is not a preference: `onclick`
      // has one slot and silently replaces whoever wrote it first, `innerText`
      // reflows to compute a value `textContent` already has, and `keyCode` is
      // unusable on any non-Latin layout.
      'unicorn/prefer-add-event-listener': 'error',
      'unicorn/prefer-keyboard-event-key': 'error',
      'unicorn/prefer-dom-node-text-content': 'error',
      'unicorn/prefer-dom-node-remove': 'error',
      'unicorn/dom-node-dataset': 'error',
      'unicorn/prefer-query-selector': 'error',
      'unicorn/prefer-event-target': 'error',
      'unicorn/prefer-blob-reading-methods': 'error',
      'unicorn/no-invalid-remove-event-listener': 'error',
      'unicorn/no-document-cookie': 'error',
      'unicorn/no-console-spaces': 'error',

      // Array and string work where the shorter form is also the clearer one.
      'unicorn/prefer-array-find': 'error',
      'unicorn/prefer-array-some': 'error',
      'unicorn/prefer-array-flat': 'error',
      'unicorn/prefer-array-flat-map': 'error',
      'unicorn/prefer-array-index-of': 'error',
      'unicorn/prefer-includes': 'error',
      'unicorn/prefer-single-call': 'error',
      'unicorn/prefer-set-has': 'error',
      'unicorn/prefer-set-size': 'error',
      'unicorn/prefer-object-from-entries': 'error',
      'unicorn/prefer-string-replace-all': 'error',
      'unicorn/prefer-string-slice': 'error',
      'unicorn/prefer-string-starts-ends-with': 'error',
      'unicorn/prefer-string-trim-start-end': 'error',
      'unicorn/prefer-negative-index': 'error',
      'unicorn/prefer-at': ['error', { checkAllIndexAccess: false }],
      'unicorn/require-array-join-separator': 'error',
      'unicorn/require-number-to-fixed-digits-argument': 'error',
      'unicorn/no-array-method-this-argument': 'error',
      // A method reference passed to `map`/`filter` receives the index and the
      // array too, which is how `['1','2','3'].map(Number.parseInt)` produces
      // a NaN nobody wrote. A warning rather than an error because all 10 sites
      // here pass a local single-parameter predicate, where the extra arguments
      // are dropped: what the rule is really guarding is the day one of those
      // functions grows a second parameter and starts reading the index as it.
      'unicorn/no-array-callback-reference': 'warn',
      'unicorn/no-useless-length-check': 'error',
      'unicorn/no-useless-spread': 'error',
      'unicorn/no-useless-fallback-in-spread': 'error',
      'unicorn/no-useless-switch-case': 'error',
      'unicorn/no-useless-undefined': 'error',
      'unicorn/no-unreadable-array-destructuring': 'error',
      'unicorn/no-unreadable-iife': 'error',
      'unicorn/no-new-array': 'error',
      'unicorn/no-new-buffer': 'error',
      'unicorn/no-for-loop': 'error',
      'unicorn/no-await-expression-member': 'error',
      'unicorn/no-unnecessary-await': 'error',
      'unicorn/no-thenable': 'error',
      'unicorn/no-this-assignment': 'error',
      // `no-object-as-default-parameter` is off. The three hits are all the
      // same deliberate shape: a recursive contract validator threading
      // `nodes = { count: 0 }` as a node budget, where the literal is what
      // gives each top-level call its own counter. The rule reads it as an
      // options bag someone might mutate; here the mutation is the point.
      'unicorn/prefer-default-parameters': 'error',
      'unicorn/prefer-export-from': 'error',
      'unicorn/prefer-native-coercion-functions': 'error',
      'unicorn/prefer-reflect-apply': 'error',
      'unicorn/prefer-regexp-test': 'error',
      'unicorn/prefer-date-now': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/prefer-math-trunc': 'error',
      'unicorn/prefer-modern-math-apis': 'error',
      'unicorn/new-for-builtins': 'error',
      'unicorn/no-instanceof-builtins': 'error',
      'unicorn/no-zero-fractions': 'error',
      'unicorn/number-literal-case': 'error',
      'unicorn/numeric-separators-style': 'error',
      'unicorn/escape-case': 'error',
      'unicorn/prefer-unicode-code-point-escapes': 'error',
      'unicorn/text-encoding-identifier-case': 'error',
      'unicorn/switch-case-braces': 'error',
      'unicorn/template-indent': 'error',
      'unicorn/prefer-logical-operator-over-ternary': 'error',
      'unicorn/no-lonely-if': 'error',
      'unicorn/prefer-switch': 'error',
      'unicorn/prefer-ternary': 'error',
      'unicorn/no-negated-condition': 'error',
      // Warnings, with the backlog they name. `reduce` reads as an accumulator
      // only to whoever wrote it; `forEach` is a loop that cannot `break` and
      // cannot `await`. Both are opinions this repository shares and has 14
      // existing call sites against, so they are a list rather than a wall.
      'unicorn/no-array-reduce': 'warn',
      'unicorn/no-for-each': 'warn',
      // A helper defined inside a component that closes over nothing is a
      // module-level function hidden from every other component that needs it.
      'unicorn/consistent-function-scoping': 'warn',

      // ------------------------------------------------------------- sonarjs

      // Default threshold on purpose. The point of adopting this is to be told
      // where the branching has outgrown the function, and a threshold tuned
      // until the report is empty measures the tuning rather than the code.
      'sonarjs/cognitive-complexity': 'warn',
      // Copy-paste damage, which is the one class of defect a reviewer reads
      // straight past: two branches that look different and are not.
      'sonarjs/no-all-duplicated-branches': 'error',
      'sonarjs/no-duplicated-branches': 'error',
      'sonarjs/no-identical-conditions': 'error',
      'sonarjs/no-identical-expressions': 'error',
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-gratuitous-expressions': 'error',
      'sonarjs/no-use-of-empty-return-value': 'error',
      'sonarjs/non-existent-operator': 'error',
      'sonarjs/no-redundant-boolean': 'error',
      'sonarjs/no-redundant-jump': 'error',
      'sonarjs/no-inverted-boolean-check': 'error',
      'sonarjs/no-same-line-conditional': 'error',
      'sonarjs/no-nested-switch': 'error',
      // A warning with 13 sites behind it, all in the wire contracts, where a
      // nested literal builds an error path like `${path}.${key}[${index}]`.
      // Each one is readable; thirteen of them are a pattern worth extracting
      // into one path helper, which is a change to make deliberately.
      'sonarjs/no-nested-template-literals': 'warn',
      'sonarjs/no-small-switch': 'error',
      'sonarjs/prefer-object-literal': 'error',
      'sonarjs/prefer-single-boolean-return': 'error',

      // What the recommended set reports here, decided once each. Three of
      // these repeat a decision this file already made about the same code
      // under a different tool's name, which is the cost of taking a vendor
      // list whole: the answer is written twice or it drifts.
      //
      // The regex pair is the same argument `security/detect-unsafe-regex` is
      // off for, above: every validated string is length-bounded before it is
      // matched, so a pattern's worst case is bounded with it. 28 findings, one
      // structural answer.
      'sonarjs/super-linear-regex': 'off',
      'sonarjs/regex-complexity': 'off',
      // And this is the core `no-control-regex` decision restated: the wire
      // validators name control characters on purpose.
      'sonarjs/no-control-regex': 'off',
      // `void` here is not a leftover, it is the marker: `void router.push(...)`
      // says the promise is deliberately not awaited, and `void input` says a
      // parameter is deliberately unread. Removing it would leave both facts
      // unstated.
      'sonarjs/void-use': 'off',
      // The seventeen this found were all one shape: a chain of tests mapping an
      // input to a value, written as a single expression. Each became a table
      // looked up by key, a `find` over ordered candidates, or a function with
      // early returns, and the backlog is empty — so this is an error now, and
      // the next nested conditional is a new decision rather than a habit.
      'sonarjs/no-nested-conditional': 'error',

      // `max-depth` is not sonarjs's, and nothing else here bounds nesting.
      'max-depth': ['error', 4],

      // Four with a backlog, each named. `!` asserts a value is there in 39
      // places where the compiler could not prove it; a function that returns a
      // value on one path and nothing on another has 12; and 8 signatures take
      // more than four positional parameters, where an options object would say
      // what each one is. `complexity` is deliberately absent — it measures
      // roughly what `sonarjs/cognitive-complexity` above already reports, and
      // two rules naming one defect is what trains people to skim.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'sonarjs/no-inconsistent-returns': 'warn',
      'sonarjs/no-nested-functions': 'warn',
      'max-params': ['warn', 4],

      // --------------------------------------------------------------- order

      // Imports grouped by the layer they come from, in the order the layers
      // are stacked in the repository instructions: app, pages, widgets,
      // features, entities, shared. The import block then reads as a statement about where a file
      // sits, and an upward import — the one thing `check:ui-system` fails on —
      // is visible as a group appearing above where it should.
      'perfectionist/sort-imports': [
        'error',
        {
          type: 'natural',
          order: 'asc',
          newlinesBetween: 1,
          internalPattern: ['^@/'],
          customGroups: [
            { groupName: 'vue', elementNamePattern: '^vue$|^vue-router$|^vue-i18n$|^pinia$' },
            { groupName: 'layer-app', elementNamePattern: '^@/app/' },
            { groupName: 'layer-pages', elementNamePattern: '^@/pages/' },
            { groupName: 'layer-widgets', elementNamePattern: '^@/widgets/' },
            { groupName: 'layer-features', elementNamePattern: '^@/features/' },
            { groupName: 'layer-entities', elementNamePattern: '^@/entities/' },
            { groupName: 'layer-shared', elementNamePattern: '^@/shared/' },
          ],
          // Selectors are unqualified on purpose. Perfectionist v5 can split a
          // group by the `type` modifier, but `import-x/consistent-type-specifier-style`
          // keeps type specifiers inline above, so a standalone `import type`
          // line is the exception here and belongs next to the value import
          // from the same place rather than in a group of its own.
          groups: [
            'builtin',
            'vue',
            'external',
            'layer-app',
            'layer-pages',
            'layer-widgets',
            'layer-features',
            'layer-entities',
            'layer-shared',
            ['parent', 'sibling', 'index'],
            'style',
            'unknown',
          ],
        },
      ],
      // Sorting the lists whose sequence carries nothing: a named-import list,
      // a re-export block, a set of literals used as a membership test. There
      // the order is an accident of typing and alphabetical removes a class of
      // merge conflict for free.
      'perfectionist/sort-named-imports': ['error', { type: 'natural', order: 'asc' }],
      'perfectionist/sort-named-exports': ['error', { type: 'natural', order: 'asc' }],
      'perfectionist/sort-exports': ['error', { type: 'natural', order: 'asc' }],
      'perfectionist/sort-array-includes': ['error', { type: 'natural', order: 'asc' }],
      // Type members, sorted for one shape everywhere. The three rules below
      // were tried once with plain alphabetical order and reverted: that pass
      // rewrote 1019 declarations and changed what several of them said. What
      // is configured here is the part of the ordering that is always true,
      // and nothing else.
      //
      // A union keeps the order it was written in. `ref<'line' | 'bars'>` puts
      // the default first, `'overlay' | 'inline'` is a placement ladder and the
      // status unions run by severity; no tool can tell a ladder from a set, so
      // the members are left alone. The one invariant a union does have is that
      // absence comes last: `null` and `undefined` are what the type does not
      // have, and reading them in the middle of the alternatives costs a beat
      // every time.
      'perfectionist/sort-union-types': [
        'error',
        { type: 'unsorted', groups: ['unknown', 'nullish'] },
      ],
      // An interface or an object type is a record, not a sequence: nothing
      // downstream reads its member order, so alphabetical is free consistency.
      // Two things temper it. Members are grouped index signature, then
      // required, then optional, then methods, because "what must be here" is
      // the question a reader arrives with. And a blank line or a comment the
      // author put between members is a grouping they meant, so sorting happens
      // inside it rather than across it — which is how the wire contracts keep
      // their envelope fields together instead of interleaving them by letter.
      'perfectionist/sort-interfaces': ['error', TYPE_MEMBER_ORDER],
      'perfectionist/sort-object-types': ['error', TYPE_MEMBER_ORDER],

      // One spelling for a type-only specifier, and here it has to be the
      // top-level one. The source config preferred `import { type Card }`; in
      // this repository that is not a style choice, because `check:ui-system`
      // decides whether an import is a runtime edge by reading whether the
      // statement begins `import type`. Inlining the specifiers turned three
      // erased edges in `shared/api` into a reported import cycle that is not
      // one, which is the guard doing exactly what its comment says it does.
      'import-x/consistent-type-specifier-style': ['error', 'prefer-top-level'],
      'import-x/no-duplicates': 'error',
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: ts.parser } },
    rules: {
      'vue/multi-word-component-names': 'off',

      /*
       * A component is a black box, and these two are what makes that a fact
       * rather than a habit: every class a scoped block selects has to be one
       * this file's own template writes.
       *
       * The failure they stop is quiet. `.registry-row > .semantic-state` named
       * two other components' classes to move one element; renaming either of
       * them leaves this rule matching nothing and reports no error, because
       * scoped CSS has no idea which file a class came from. The same went for
       * `svg`, which is Lucide's element inside `VIcon`, and for `.button`,
       * which is `VButton`'s root — a tag and a class neither primitive ever
       * promised to keep.
       *
       * What replaces them is the channel Vue already has: a class written on a
       * child component tag lands on that child's root along with this file's
       * scope id, so `<VIcon class="note-icon" />` styles the same element from
       * a name this file owns. Where the reach went deeper than a root, the
       * answer is the child positioning its own slot with `:slotted()`, or a
       * custom property the host declares and the child reads — both already
       * in use here.
       *
       * `no-unused-selector` reports the rightmost part it cannot find;
       * `require-selector-used-inside` requires the whole chain, which is what
       * catches `.skills-alert button` where the alert is ours and the button is
       * not. Both are errors: they have nothing to report, and a rule with
       * nothing to report costs nobody anything. Neither sees `:deep()`,
       * `:global()` or `:slotted()` — those say out loud that a boundary is
       * being crossed, and `check:ui-system` is what holds them to a reason.
       */
      'vue-scoped-css/no-unused-selector': 'error',
      'vue-scoped-css/require-selector-used-inside': 'error',

      // What a template expression may be, and what a component may publish an
      // event about. Both lists carry their argument in the module beside this
      // config, because both need one longer than a rule line.
      'vue/no-restricted-syntax': ['error', ...templateExpressions],
      'no-restricted-syntax': ['error', ...componentChannels, ...watchSources],

      // What an SFC in this repository is, stated so a new one cannot be
      // something else: TypeScript, `<script setup>`, and a `<style scoped>`
      // in plain CSS. `block-lang` names only the script on purpose — the
      // styles here are CSS with native nesting, and a `lang` on the style
      // block is exactly the SCSS this project decided against.
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      // Script first, which is what all 55 components here already do. The
      // order is arbitrary in itself and the rule's value is only that one
      // order holds; picking the other one would have rewritten every file in
      // the repository to say the same thing differently.
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/enforce-style-attribute': ['error', { allow: ['scoped'] }],

      // Props and emits are declared as types, which is the only form the
      // compiler can check against the call site. The runtime object form was
      // the older half of this choice and is now the one that loses type
      // information.
      'vue/define-props-declaration': ['error', 'type-based'],
      'vue/define-emits-declaration': ['error', 'type-literal'],
      'vue/define-macros-order': ['warn', { defineExposeLast: true }],
      'vue/prefer-define-options': 'warn',
      'vue/valid-define-options': 'error',
      'vue/require-macro-variable-name': 'warn',
      'vue/no-unused-emit-declarations': 'warn',
      // With type-based props the compiler already rejects a missing required
      // prop, and `withDefaults` covers the optional ones. The rule cannot see
      // either, so it only asks for a default on props that are allowed to be
      // absent.
      'vue/require-default-prop': 'off',
      'vue/require-typed-object-prop': 'warn',
      'vue/prefer-prop-type-boolean-first': 'warn',

      // One casing for one thing, in the file name, the definition, the import
      // and the template, so a component can be found by grep for its name.
      'vue/component-definition-name-casing': ['error', 'PascalCase'],
      'vue/component-options-name-casing': ['warn', 'PascalCase'],
      'vue/component-name-in-template-casing': [
        'error',
        'PascalCase',
        { registeredComponentsOnly: false },
      ],
      'vue/match-component-file-name': ['error', { extensions: ['vue'], shouldMatchCase: true }],
      'vue/match-component-import-name': 'error',
      // An event name is part of the template's vocabulary, where kebab-case is
      // what HTML reads. The second ignore is not a preference: `v-model` on a
      // prop named `modelValue` emits `update:modelValue`, so demanding kebab
      // there would be the linter arguing with Vue's own pairing rule and would
      // break every two-way-bound primitive in `shared/ui`.
      'vue/custom-event-name-casing': [
        'error',
        'kebab-case',
        {
          ignores: [
            '/^[a-z]+(?:-[a-z]+)*:[a-z]+(?:-[a-z]+)*$/u',
            '/^update:[a-z]+(?:[A-Z][a-z]*)*$/u',
          ],
        },
      ],
      'vue/v-on-event-hyphenation': ['warn', 'always', { autofix: true }],

      // Attribute order, which perfectionist used to own through
      // `sort-vue-attributes` until that rule was removed in its v4. This is
      // the replacement, and it has to exist: the rule it replaced was the
      // reason `vue/attributes-order` had been switched off.
      'vue/attributes-order': [
        'error',
        {
          order: [
            'DEFINITION',
            'LIST_RENDERING',
            'CONDITIONALS',
            'RENDER_MODIFIERS',
            'GLOBAL',
            ['UNIQUE', 'SLOT'],
            'TWO_WAY_BINDING',
            'OTHER_DIRECTIVES',
            'ATTR_STATIC',
            'ATTR_DYNAMIC',
            'ATTR_SHORTHAND_BOOL',
            'EVENTS',
            'CONTENT',
          ],
          alphabetical: false,
        },
      ],

      // Styling written where the stylesheet can see it. An inline `style` is
      // invisible to `stylelint`, which is where this repository's whole token
      // contract lives, so it is the one way to spend a hard-coded pixel
      // without any guard noticing.
      'vue/no-static-inline-styles': 'error',
      'vue/prefer-separate-static-class': 'error',
      'vue/no-multiple-objects-in-class': 'error',

      'vue/html-button-has-type': ['error', { button: true, submit: true, reset: true }],
      'vue/html-self-closing': [
        'warn',
        {
          html: { component: 'always', normal: 'always', void: 'any' },
          math: 'always',
          svg: 'always',
        },
      ],
      'vue/no-duplicate-attr-inheritance': 'error',
      'vue/no-useless-mustaches': [
        'error',
        { ignoreIncludesComment: false, ignoreStringEscape: true },
      ],
      'vue/no-useless-v-bind': [
        'error',
        { ignoreIncludesComment: false, ignoreStringEscape: false },
      ],
      'vue/no-v-text': 'error',
      'vue/v-for-delimiter-style': ['error', 'in'],
      'vue/next-tick-style': ['error', 'promise'],
      'vue/prefer-import-from-vue': 'warn',
      'vue/prefer-template': 'warn',
      // Destructuring a ref reads its value once and then never again, which
      // shows up as a view that stopped updating rather than as an error.
      'vue/no-ref-object-reactivity-loss': 'error',
      // Every component this app renders is imported by name in the same file,
      // so an unresolved tag is a typo rather than a global registration the
      // rule cannot see.
      'vue/no-undef-components': 'error',
    },
  },
  {
    // A doc comment that restates the name of the thing it sits above is worse
    // than none: it takes a line, survives every rename, and teaches the reader
    // that comments here carry nothing. `informative-docs` is the mature answer
    // to what the "AI comment slop" plugins were written for, and it reports
    // nothing across this repository today.
    plugins: { depend, jsdoc },
    rules: {
      'jsdoc/informative-docs': 'error',
      'jsdoc/no-blank-blocks': 'error',
      'jsdoc/require-asterisk-prefix': 'error',
      // A dependency added for something the platform already does. Knip finds
      // the ones nothing imports; this finds the ones that should never have
      // been reached for.
      'depend/ban-dependencies': 'error',
    },
  },
  {
    // What a test suite cannot report about itself. A case with no assertion
    // passes forever, a focused one silently skips its neighbours, and a
    // commented-out one is a test that was deleted without saying so.
    files: ['tests/**/*.{ts,mjs}'],
    plugins: { vitest },
    rules: {
      'vitest/expect-expect': 'error',
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-commented-out-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-conditional-expect': 'error',
      'vitest/valid-expect': 'error',
      'vitest/prefer-to-be': 'error',
    },
  },
  {
    // The browser suite runs under Playwright rather than Vitest, and its
    // failure modes are its own: a conditional assertion that quietly proves
    // nothing, or a wait that depends on the network going quiet.
    files: ['tests/browser/**/*.ts'],
    ...playwright.configs['flat/recommended'],
  },
  {
    files: ['tests/browser/**/*.ts'],
    rules: {
      // One site, and replacing it needs a browser run to confirm the layout
      // has settled without it: the clipping assertion that follows reads
      // geometry, so an earlier wait would report on a frame nobody sees.
      'playwright/no-networkidle': 'warn',
    },
  },
  {
    // The one component whose styles cannot be scoped. `SelectPortal` renders
    // the popup at the end of `<body>`, outside this component's subtree, so
    // the data attribute `scoped` adds never reaches ten of the fifteen classes
    // in the block — the search field, the viewport, the options and their
    // icons. Splitting the block in two would scope the trigger and leave the
    // popup global, which is the same exception written twice.
    files: ['src/shared/ui/ChoiceSelect.vue'],
    rules: { 'vue/enforce-style-attribute': 'off' },
  },
  {
    // Fixtures deliberately probe third-party option shapes and malformed
    // payloads, which is exactly what the strict rule forbids in product code.
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  ...Object.entries(LINE_DEBT).map(([file, max]) => ({
    files: [file],
    rules: { 'max-lines': ['warn', { max, skipBlankLines: true, skipComments: true }] },
  })),
  // Last, so it wins: oxlint runs the same rules ahead of ESLint and reports
  // them faster, and two tools reporting one defect trains people to skim.
  ...oxlint.configs['flat/recommended'],
  prettier,
)
