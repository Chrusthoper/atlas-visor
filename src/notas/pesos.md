# Pesos (w)

Cada entrada tiene un peso que indica **cuánto influye** en la decisión final.

| Peso | Significado |
|------|-------------|
| positivo (+) | Favorece la activación (aumenta z) |
| negativo (−) | Inhibe la activación (disminuye z) |
| ≈ 0 | Casi no influye en la decisión |

La regla de actualización es:

```
w[i] = w[i] + eta * e * x[i]
```
