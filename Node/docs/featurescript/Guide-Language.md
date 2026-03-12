# FeatureScript Language Reference

FeatureScript is a strongly typed, dynamically typed programming language purpose-built for parametric CAD modeling inside Onshape.

This guide covers the full language syntax and semantics. It is intended as a reference for AI agents writing FeatureScript code.

---

## 1. Basics

- **Strongly typed, dynamically typed** -- every value has a definite type at runtime, but variables are not bound to a single type at compile time.
- **Semicolons are always required** at the end of statements.
- **Whitespace insensitive** -- indentation and blank lines have no syntactic meaning.
- **Comments** follow C-style conventions:
  - `//` single-line comment
  - `/* ... */` multi-line comment
- **Deterministic** -- given the same inputs and parameter values, a model regenerates identically every time. There is no random number generator and no access to wall-clock time.

---

## 2. The 9 Standard Types

FeatureScript has exactly nine built-in types. Every value belongs to one of these.

### boolean

Two possible values: `true` and `false`.

```
var flag = true;
if (flag)
    println("yes");
```

### number

64-bit IEEE 754 double-precision floating point. Integers are a special case (a number whose value is a whole number). There is no separate integer type.

Literal forms:

```
1
1.0
-.01
1e6
1.5e-3
inf
```

NaN does not exist as a usable value. Any operation that would produce NaN throws an error instead.

```
var x = 0 / 0; // throws error
```

### string

Delimited by single quotes or double quotes. Both are equivalent.

```
var greeting = "hello";
var other = 'world';
```

Supported escape sequences: `\b`, `\t`, `\n`, `\f`, `\r`, `\\`, `\"`, `\'`, `\uXXXX` (Unicode code point).

String concatenation uses the `~` operator, not `+`:

```
var msg = "The answer is " ~ 42; // "The answer is 42"
```

Useful string functions from the standard library:

```
var str = replace("The answer is 42.", "[1-9]+", "X");
// str == "The answer is X."
var len = length("abc"); // 3
```

### array

An ordered list of values. Elements need not be the same type.

```
var empty = [];
var numbers = [1, 2, 3];
var things = ["1", 2, ["inner"]];
```

Indexing is zero-based:

```
var x = numbers[0]; // 1
numbers[2] = 99;    // numbers is now [1, 2, 99]
```

Safe navigation -- returns `undefined` instead of throwing when the base is `undefined`:

```
var z = undefined?[1]; // undefined (no error)
```

Common container functions:

```
var s = size(numbers);                      // 3
numbers = append(numbers, 4);               // [1, 2, 99, 4]
numbers = concatenateArrays([numbers, [5, 6]]);
// [1, 2, 99, 4, 5, 6]
```

### map

An unordered collection of key-value pairs. Keys can be strings, numbers, booleans, enums, or other immutable values.

When a map literal uses unquoted identifiers as keys, they are treated as strings:

```
var m = { "a" : 1, one : 1 };
// m["a"] == 1, m["one"] == 1
```

Field access:

```
var val = m.a;       // dot syntax (equivalent to m["a"])
var val2 = m["a"];   // bracket syntax
```

Adding and removing keys:

```
m.b = 2;             // adds key "b"
m.b = undefined;     // removes key "b"
```

Safe navigation -- returns `undefined` instead of throwing when the base is `undefined`:

```
var d = undefined?.a; // undefined (no error)
```

Iteration over a map:

```
for (var key, value in myMap)
{
    println(key ~ " = " ~ value);
}
```

### box

A box provides reference semantics. It is the only way to share mutable state between two variables or across function boundaries.

```
var b1 = new box(1);
var b2 = b1;          // b2 points to the SAME box
b1[] = 42;
println(b2[]);         // 42
```

Access the contents with `[]`:

```
var contents = b1[];   // read
b1[] = "new value";    // write
```

Safe navigation for boxes:

```
var x = undefined?[]; // undefined (no error)
```

### function

Functions are first-class values. They can be stored in variables, passed as arguments, and returned from other functions.

Lambda syntax:

```
var f = function(x) { return x + 1; };
var g = x => x + 1;
```

Typed lambda with return annotation:

```
const twice = function(v is ValueWithUnits) returns ValueWithUnits
{
    return v * 2;
};
```

Arrow shorthand with type constraints:

```
const twice = (v is ValueWithUnits) => v * 2;
```

### builtin

An opaque value created and managed by the Onshape Standard Library. Examples include `Context`, `Sketch`, `Query`, and `Id`. You cannot inspect or modify a builtin directly -- you pass it to Standard Library functions that know how to use it.

```
// context is a builtin
var context = newContext();
```

### undefined

A special type with exactly one value: `undefined`. It represents the absence of a value.

Common situations that produce `undefined`:

- Accessing a map key that does not exist
- A variable declared but not yet assigned
- A function that does not return a value
- A `try()` expression that catches an error

```
var m = {};
var x = m.missing;    // undefined
var y = try(0 / 0);   // undefined (error was caught)
```

---

## 3. Type Tags

A type tag is a custom type label attached to a value. The underlying value is still one of the 9 standard types, but the tag adds semantic meaning and enables type checking.

Type tags are checked with `is` and created with `as`.

### Enums

An enum declares a fixed set of named constants.

```
export enum LumberSize { TWO_BY_FOUR, TWO_BY_SIX }

var size is LumberSize = LumberSize.TWO_BY_FOUR;
```

Enums are comparable only within the same enum type. They are ordered by declaration order (first declared is smallest).

### Custom Types

A custom type is declared with `type`, optionally paired with a `typecheck` predicate that validates the underlying value.

```
export type Lumber typecheck isLumber;

export predicate isLumber(value)
{
    value is map;
    value.size is LumberSize;
    isLength(value.length);
}
```

A constructor function typically builds the underlying value and tags it:

```
export function lumber(size is LumberSize, length is ValueWithUnits) returns Lumber
{
    return { "size" : size, "length" : length } as Lumber;
}
```

### Type Operators

- **`is`** -- type check. Returns `true` if the value has the given type or type tag.

```
var v = lumber(LumberSize.TWO_BY_FOUR, 8 * foot);
println(v is Lumber);  // true
println(v is map);     // true (underlying type is still map)
println(v is string);  // false
```

- **`as`** -- type cast. Attaches a type tag to a value. If a typecheck predicate is defined for the type, `as` does NOT run it -- it unconditionally attaches the tag. Use with care.

```
var raw = { "size" : LumberSize.TWO_BY_FOUR, "length" : 8 * foot };
var tagged = raw as Lumber; // tag attached, no validation
```

---

## 4. Variables and Constants

### var

Declares a mutable variable. Must be initialized at declaration.

```
var x = 1;
x = 2; // OK
```

### const

Declares an immutable binding. Must be initialized at declaration.

```
const y = 2;
// y = 3; // ERROR: cannot reassign a const
```

### Typed declarations

A variable can specify a type constraint. The initializer must satisfy the constraint.

```
var z is number = 1;
const name is string = "bolt";
```

### Copy-on-assign semantics

Assignment always makes a deep copy. There is no reference sharing between variables (except through `box`).

```
var a = [1, 2, 3];
var b = a;        // b is an independent copy
b[0] = 99;
println(a[0]);    // 1 (unchanged)
```

### Block scoping

Variables are scoped to the nearest enclosing `{}` block.

```
{
    var inner = 10;
}
// inner is not accessible here
```

---

## 5. Operators

### Arithmetic

| Operator | Meaning         | Example         |
|----------|-----------------|-----------------|
| `+`      | Addition        | `3 + 4` = `7`  |
| `-`      | Subtraction / negation | `5 - 2` = `3`, `-x` |
| `*`      | Multiplication  | `3 * 4` = `12` |
| `/`      | Division        | `7 / 2` = `3.5` |
| `%`      | Modulo          | `7 % 3` = `1`  |
| `^`      | Exponentiation  | `2 ^ 10` = `1024` |

### String concatenation

The `~` operator concatenates strings. Non-string values are converted to their string representation automatically.

```
"count: " ~ 42         // "count: 42"
"list: " ~ [1, 2, 3]   // "list: [1, 2, 3]"
```

### Comparison

| Operator | Meaning                |
|----------|------------------------|
| `<`      | Less than              |
| `>`      | Greater than           |
| `<=`     | Less than or equal     |
| `>=`     | Greater than or equal  |
| `==`     | Equal                  |
| `!=`     | Not equal              |

### Logical

| Operator | Meaning     | Notes                  |
|----------|-------------|------------------------|
| `&&`     | Logical AND | Short-circuiting       |
| `\|\|`   | Logical OR  | Short-circuiting       |
| `!`      | Logical NOT |                        |

Short-circuiting means the right operand is not evaluated if the left operand determines the result.

### Null-coalescing

```
var x = maybeUndefined ?? defaultValue;
```

Returns the left operand if it is not `undefined`; otherwise returns the right operand.

### Assignment operators

| Operator | Equivalent to       |
|----------|---------------------|
| `=`      | Simple assignment   |
| `+=`     | `x = x + rhs`      |
| `-=`     | `x = x - rhs`      |
| `*=`     | `x = x * rhs`      |
| `/=`     | `x = x / rhs`      |
| `^=`     | `x = x ^ rhs`      |
| `%=`     | `x = x % rhs`      |
| `\|\|=`  | `x = x \|\| rhs`   |
| `&&=`    | `x = x && rhs`     |
| `??=`    | `x = x ?? rhs`     |
| `~=`     | `x = x ~ rhs`      |

### Access operators

| Operator | Meaning                             |
|----------|-------------------------------------|
| `.`      | Map field access (`m.key`)          |
| `[]`     | Array index, map key, or box access |

### Safe navigation

Safe navigation operators return `undefined` instead of throwing when the base is `undefined`:

| Operator | Meaning                           |
|----------|-----------------------------------|
| `?.`     | Safe map field access             |
| `?[]`    | Safe array/map/box bracket access |

```
var x = undefined?.foo;    // undefined
var y = undefined?[0];     // undefined
var z = undefined?[];      // undefined (box access)
```

### Ternary conditional

```
var result = condition ? valueIfTrue : valueIfFalse;
```

### Arrow operator

The `->` operator rewrites a method-style call into a function call, passing the left side as the first argument:

```
x->f(y)    // equivalent to f(x, y)
x->g()     // equivalent to g(x)
```

This is useful for chaining Standard Library calls:

```
var q = qCreatedBy(id + "extrude1", EntityType.FACE)
    ->qIntersection(qCreatedBy(id + "sketch1", EntityType.FACE));
```

---

## 6. Control Flow

### if / else if / else

```
if (x > 0)
{
    println("positive");
}
else if (x == 0)
{
    println("zero");
}
else
{
    println("negative");
}
```

Braces are optional for single-statement bodies, but recommended for clarity.

### while

```
var x = 0;
var done = false;
while (!done)
{
    x += 1;
    done = f(x);
}
```

### for

C-style for loop. Note: FeatureScript uses `+=` for increment, not `++`.

```
for (var i = 0; i != 10; i += 1)
{
    f(i);
}
```

### for-in

Iterate over the elements of an array:

```
for (var x in [1, 2, 3])
{
    println(x);
}
```

Iterate over key-value pairs of a map:

```
for (var key, value in myMap)
{
    println(key ~ " = " ~ value);
}
```

### break and continue

Standard behavior within loops:

- `break` -- exit the innermost loop immediately.
- `continue` -- skip the rest of the current iteration and proceed to the next.

```
for (var i = 0; i < 100; i += 1)
{
    if (i % 2 == 0)
        continue; // skip even numbers
    if (i > 50)
        break;    // stop after 50
    println(i);
}
```

---

## 7. Functions

Functions are defined at the top level with the `function` keyword.

```
function fourthPower(x)
{
    const square = x * x;
    return square * square;
}
```

A function that does not execute a `return` statement (or reaches the end of its body) returns `undefined`.

### Return type annotation

An optional return type can be specified. It is checked at runtime.

```
function double(x) returns number
{
    return x * 2;
}
```

### Parameter type constraints

Parameters can specify a type with `is`. The constraint is checked when the function is called.

```
function hypotenuse(a is number, b is number) returns number
{
    return sqrt(a ^ 2 + b ^ 2);
}
```

### Preconditions

A `precondition` block runs before the function body. Each statement in the block must evaluate to `true`, or the call fails. Preconditions are used both for validation and (in feature functions) to define the feature dialog UI.

```
function sqrt(n is number) returns number
precondition n >= 0;
{
    // implementation
}
```

Multi-statement precondition:

```
function clamp(value is number, lo is number, hi is number) returns number
precondition
{
    lo <= hi;
}
{
    if (value < lo)
        return lo;
    if (value > hi)
        return hi;
    return value;
}
```

### Overloading

Multiple functions can share the same name if they have different parameter type constraints. When the function is called, FeatureScript picks the most specific matching overload.

```
function describe(x is number)
{
    println("a number: " ~ x);
}

function describe(x is string)
{
    println("a string: " ~ x);
}

function describe(x)
{
    println("something else: " ~ x);
}
```

If two overloads are equally specific for a given call, the call is ambiguous and throws an error.

---

## 8. Predicates

A predicate is a special subroutine that always returns a boolean. It cannot have side effects and cannot call functions that have side effects.

Every statement inside a predicate body is implicitly an assertion. If any statement evaluates to `false`, the predicate returns `false`. If all statements pass, it returns `true`.

```
predicate canBeUsed(x, y)
{
    isUseful(x);
    if (y is array)
    {
        for (var element in y)
        {
            element is UsefulType;
        }
    }
}
```

Predicates are commonly used as:

- Typecheck predicates for custom types
- Precondition blocks in feature functions
- Validation helpers

---

## 9. Operator Overloads

The following operators can be overloaded: `+`, `-`, `*`, `/`, `%`, `^`, `<`.

At least one parameter must have a custom type tag.

```
operator+(lhs is Vector, rhs is Vector) returns Vector
{
    return vector(lhs.x + rhs.x, lhs.y + rhs.y, lhs.z + rhs.z);
}

operator*(x is Vector, y is number) returns Vector
{
    return vector(x.x * y, x.y * y, x.z * y);
}
```

Overloading `<` automatically provides `>`, `<=`, and `>=` for the same types.

---

## 10. Exception Handling

### try expression

Wraps an expression. If the expression throws, the result is `undefined`.

```
var result = try(0 / 0);    // undefined (division by zero caught)
var ok = try(1 + 1);        // 2
```

### try statement

Wraps a block of statements. Optionally includes a `catch` block.

```
try
{
    riskyOperation();
}
```

With catch (no error variable):

```
try
{
    riskyOperation();
}
catch
{
    handleFailure();
}
```

With catch (error variable):

```
try
{
    riskyOperation();
}
catch (e)
{
    println("Error: " ~ e);
}
```

### try silent

Suppresses error reporting entirely. The error is still caught, but it will not appear in the Feature notices pane. Useful when you expect an operation might fail and want to handle it quietly.

```
var x = try silent(myMap.submapThatMayNotExist.subMapKey);
```

### throw

Throws an error. The thrown value can be any type, but is typically a string or a map with a `message` field.

```
throw "an error has occurred";
throw { "message" : ErrorStringEnum.TOO_MANY_ENTITIES_SELECTED };
```

The `regenError` function from the Standard Library creates user-facing errors that display in the feature dialog:

```
throw regenError("Wall thickness must be positive");
throw regenError("Select at least one face", ["faceQuery"]);
```

---

## 11. Top-Level Constructs

A FeatureScript file (Feature Studio tab) can contain only these constructs at the top level:

- **Import statements** -- bring in symbols from the Standard Library or other Feature Studios.
- **Function definitions** -- including feature functions.
- **Predicate definitions** -- validation and typecheck predicates.
- **Operator overload definitions** -- custom operator behavior.
- **Constant declarations** -- top-level `const`. Initializers must not contain boxes or builtins, and must not form cycles.
- **Enum declarations** -- `enum` definitions.
- **Custom type declarations** -- `type` definitions.

### The `export` keyword

Any top-level definition can be prefixed with `export` to make it visible to other Feature Studios that import this one.

```
export const MAX_BOLTS = 100;

export function computeLength(params is map) returns ValueWithUnits
{
    // ...
}

export enum BoltType { HEX, SOCKET, CARRIAGE }
```

Symbols that are not exported are private to their Feature Studio.

---

## 12. Imports

Every FeatureScript file begins with one or more `import` statements to load the Standard Library and/or other Feature Studios.

### Standard Library import

```
import(path : "onshape/std/geometry.fs", version : "2026.0");
```

The `geometry.fs` module re-exports the entire Standard Library. The version string corresponds to the Onshape release version.

### Import from a tab in the same document

Use the 24-character element ID and a version/microversion ID:

```
import(path : "990d0d558752560035c1bc8e", version : "e83d3c3d23dea63825b44d09");
```

### Import from an external document

Use the format `documentId/versionId/elementId`:

```
import(path : "62bfa9d.../c28fe04.../aa388ed...", version : "56c4b769...");
```

### Namespaced imports

To avoid name collisions, prefix an import with a namespace:

```
MyFunctions::import(path : "onshape/std/math.fs", version : "2026.0");
const PI2 = MyFunctions::PI * 2;
```

All symbols from that import are accessed through the namespace prefix.

---

## 13. Equality and Ordering

### Equality (`==` and `!=`)

FeatureScript has a single equality operator. There is no `===` or `!==`.

Two values are equal if and only if:
1. They have the same standard type.
2. They have the same type tag (or both have no type tag).
3. Their contents are equal.

Special cases:

- **Boxes**: equal only to themselves (identity comparison, not structural).
- **Lambda functions**: equal if they were created from the same definition with equal bound (captured) values.
- **Maps**: equal if they have exactly the same key-value pairs.
- **Arrays**: equal if they have the same length and all corresponding elements are equal.
- **undefined**: `undefined == undefined` is `true`.

### Ordering (`<`, `>`, `<=`, `>=`)

Values of different types are ordered by type:

```
undefined < boolean < number < string < array < map < box < builtin < function
```

Within the same type:
- **boolean**: `false < true`
- **number**: standard numeric ordering
- **string**: lexicographic ordering
- **array**: element-by-element comparison (shorter arrays are less than longer ones if all elements match)
- **Enums**: ordered by declaration order (first declared is smallest). Comparable only within the same enum type; comparing across enum types throws an error.

---

## 14. Units (ValueWithUnits)

FeatureScript uses a `ValueWithUnits` type for all physical quantities. A `ValueWithUnits` is created by multiplying a number by a unit constant.

```
const width = 1.5 * inch;
const angle = 30 * degree;
const area = 12 * centimeter ^ 2;
```

Units are checked at runtime. You can add or subtract values with compatible units, but mixing incompatible units throws an error:

```
var totalLength = 3 * meter + 3 * inch;   // OK: both are lengths
var squareArea = (3 * meter + 3 * inch) ^ 2; // OK: length squared = area
var nonsense = (3 * meter) + (3 * degree); // ERROR: length + angle
```

Unit equality is based on the underlying SI value:

```
1 * meter == 1000 * millimeter  // true
1 * inch == 25.4 * millimeter   // true
```

Common unit constants (defined in the Standard Library):

| Category | Constants |
|----------|-----------|
| Length   | `meter`, `centimeter`, `millimeter`, `inch`, `foot`, `yard` |
| Angle    | `radian`, `degree` |
| Mass     | `kilogram`, `gram`, `pound`, `ounce` |
| Force    | `newton`, `poundForce`, `kilogramForce` |
| Pressure | `pascal`, `megaPascal`, `psi` |
| Time     | `second`, `minute`, `hour` |

To extract the raw number from a `ValueWithUnits`, divide by the desired unit:

```
var lengthInMm = width / millimeter; // plain number
```

---

## See Also

- `Math.json` > `units.fs` for all unit constants and mathematical functions.
- `Modeling.json` > `query.fs` for Query functions used to select geometry.
- `INDEX.md` for the full FeatureScript Standard Library documentation index.
