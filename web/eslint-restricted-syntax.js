/**
 * The lists of syntax this repository refuses, and why each one is on them.
 *
 * They sit beside `eslint.config.ts` rather than in it for the reason the
 * stylelint presets do: a rule that needs a page of argument buries forty rules
 * that need none, and the config was two lines under its own `max-lines` ceiling
 * before any of these lists grew. All three are spent through `no-restricted-syntax`
 * — one through the plugin's template-aware copy, two through the core rule — so
 * this file holds the arguments and the config holds the wiring.
 */

// Vue's own style guide, under "Simple expressions in templates", asks that a
// template hold only simple expressions and that anything more be a computed
// or a method. There is no purpose-built rule for it: eslint-plugin-vue has
// carried the proposal as issue #253 since 2017 and still ships none, and
// sonarjs/expression-complexity never sees a template at all — it counts
// conditional operators in script and does not register a template visitor.
// What the plugin does ship is this rule, and its own documentation uses a
// selector over `VExpressionContainer` as the example, with `{{ foo }}` good
// and `{{ foo() }}` bad.
//
// So: a call on data — `labels.join(' ')`, `checklist.filter(…).length` — and
// a `new Date(…)` both run on every re-render and hide a derivation where no
// test and no reader looks for it. Both move into a computed, or into a named
// function when the value depends on a `v-for` item and a computed cannot
// take one.
//
// Narrower than the documented example on purpose. A bare call to a script
// function is the fix, not the defect, so only calls through a member
// expression are named. Template literals are left out for the same reason:
// `t(`key.${id}`)` builds an i18n key and `` `${width}px` `` builds a unit,
// and neither is a derivation of what the reader sees.
//
// A conditional joins them, and it is the one shape with no honest reading
// as markup. `v-if` is how a template branches; a `?:` inside an expression
// branches on a *value*, which is a derivation by definition — 40 of them
// were here, and every one turned out to be a label, an icon, an ARIA state
// or a prop that a computed or a `v-for` function could name. Two of the 40
// were dead, re-applying a condition their own computed had already
// applied, which is what a derivation hidden in markup costs: no test and
// no reader looks there.
//
// `x || undefined` is the same defect wearing the presence trick. Vue drops
// an attribute whose value is `null` or `undefined`, so the idiom exists
// only to make one go away, and it reads as a fallback rather than as the
// decision it is. Named in the script it can say why the attribute must be
// absent rather than false — `aria-hidden="false"` is a claim, not a
// default. Only `undefined` on the right is named: every other `||` here is
// an ordinary fallback and `&&` in a `v-if` is a condition, not a value.
export const templateExpressions = [
  {
    selector: "VExpressionContainer CallExpression[callee.type='MemberExpression']",
    message:
      'Move this call out of the template: a computed, or a function when it takes a v-for item.',
  },
  {
    selector: 'VExpressionContainer NewExpression',
    message: 'Construct this in a computed or a function, not on every re-render of the template.',
  },
  {
    selector: 'VExpressionContainer ConditionalExpression',
    message:
      'A template shows a value and does not choose one. Name this in a computed, or in a function when it takes a v-for item.',
  },
  {
    // `right.type` is tested first because esquery reads a missing path as
    // the string "undefined": on its own, `[right.name='undefined']`
    // matches every `||` in the tree rather than the seven meant here.
    selector:
      "VExpressionContainer LogicalExpression[right.type='Identifier'][right.name='undefined']",
    message:
      'Name this in a computed or a function, where it can say why the attribute must be absent rather than false.',
  },
  {
    // A comparison is a decision with a name, and the name is what the reader
    // came for: `:busy="pendingAssignment === assignment.assignment_id"` says how
    // the row found out it is busy and never says that it is. Twenty-one of these
    // were here and every one had a name available — `unmapped(project)`,
    // `isSelected(entry)`, `hasFlowData` — several of them a name the same file
    // was already spelling out a second time three lines away.
    //
    // `v-if` and `v-else-if` are deliberately outside this: a branch condition is
    // what the directive is for, and moving it to a computed moves it away from
    // the branch it governs. The line is between a template that chooses which
    // markup exists and a template that computes what an attribute carries.
    //
    // Nested comparisons count. `:class="{ selected: id === row.id }"` is the same
    // decision, and it is usually the second copy of one already made for an ARIA
    // attribute on the same tag.
    selector:
      "VAttribute[key.name.name='bind'] BinaryExpression[operator=/^(?:===|!==|==|!=|<|>|<=|>=)$/]",
    message:
      'A bound attribute carries a fact; deciding one is a derivation. Name it in a computed, or in a function when it takes a v-for item.',
  },
]

// A control that carries a value has one channel for it, and Vue already
// names that channel. `ToggleSwitch` and `ChoiceSelect` each declared
// `change` beside `update:modelValue` and emitted both with the same value
// in the same statement, so every caller had two names to pick from for one
// event. The duplicate won wherever it was offered: all four `ToggleSwitch`
// call sites listened for `change` and wrote the model back by hand, and not
// one of them reached for `v-model`. `ChoiceSelect`'s copy had no listener at
// all and had been dead since it was written, which no rule here could see,
// because an emit that the component itself raises is a used emit.
//
// The names are the DOM's, and that is the whole appeal: `change` and
// `input` look like what a native control does. A component is not a native
// control, and its value moving is what a model publishes.
//
// Anchored regexes, which is also what keeps the esquery trap harmless: a
// missing path reads as the string "undefined" and matches neither.

export const componentChannels = [
  {
    selector:
      "CallExpression[callee.name='defineEmits'] TSPropertySignature[key.value=/^(?:change|input)$/], CallExpression[callee.name='defineEmits'] TSPropertySignature[key.name=/^(?:change|input)$/]",
    message:
      'A component publishes a changed value through its model. Declaring `change` or `input` beside `update:modelValue` gives one value two channels, and callers then choose between them.',
  },
]

// A watcher's getter is compared with `Object.is`, and an array literal is a new
// reference every time it is evaluated. So `watch(() => [a, b], cb)` does not
// watch a and b — it fires whenever anything the getter read was touched, which
// is every re-render that reaches either of them.
//
// Seven of these were here and two were live defects: a planning surface that
// cleared its navigation trail on every route write, so a related item never
// offered Back, and a summary form that re-seeded its drafts on every re-read of
// the item, overwriting whatever the operator was typing — the exact failure its
// own comment said the watcher existed to prevent. Neither was visible in the
// code, because the shape reads like it names two dependencies.
//
// `watch([a, b], cb)` compares each source, and the callback still destructures.
// A getter returning one value is fine and is not named here.
export const watchSources = [
  {
    selector:
      "CallExpression[callee.name='watch'] > ArrowFunctionExpression > ArrayExpression, CallExpression[callee.name='watch'] > ArrowFunctionExpression > TSAsExpression > ArrayExpression",
    message:
      'Watch an array of sources — watch([a, b], cb) — not a getter returning a fresh array: an array literal is a new reference every evaluation, so the watcher fires on any dependency touch instead of on a change.',
  },
]
