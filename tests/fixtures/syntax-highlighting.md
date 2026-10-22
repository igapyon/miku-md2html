# Syntax highlighting benchmark

This document is the fixed before/after input for the syntax-highlighting bundle and conversion measurements.

## Markdown

````markdown
# Heading

- **bold** and `inline code`
```js
const nested = true;
```
````

## Java

```java
public final class Example {
  public static void main(String[] args) {
    System.out.println("hello");
  }
}
```

## JavaScript

```javascript
const answer = (items) => items.map((item) => item.value ?? 0);
console.log(answer([{ value: 42 }]));
```

## TypeScript

```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw result.error;
  return result.value;
};
```

## Python

```python
def greet(name: str) -> str:
    return f"hello, {name}"
```

## CSS

```css
.card > h2:hover {
  color: #5263a6;
  margin-inline: 1rem;
}
```

## HTML

```html
<main aria-label="Example">
  <script>const ready = true;</script>
</main>
```

## XML

```xml
<?xml version="1.0"?>
<message kind="greeting">hello</message>
```

## JSON

```json
{"answer": 42, "ready": true, "items": ["one", null]}
```

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail
printf 'hello %s\n' "${USER:-world}"
```

## YAML

```yaml
service:
  name: example
  enabled: true
  retries: 3
```

## Diff

```diff
--- a/example.txt
+++ b/example.txt
@@ -1,2 +1,2 @@
-old value
+new value
```

## PowerShell

```powershell
param([string]$Name = "world")
Write-Output "hello, $Name"
```
