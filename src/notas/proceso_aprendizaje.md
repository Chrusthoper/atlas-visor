# ¿Cómo aprende?

El aprendizaje del perceptrón sigue siempre el mismo ciclo:

```
Error → Actualización de parámetros → Nueva frontera
```

1. Predecir: `ŷ = φ(w^T x + b)`
2. Comparar: `e = y − ŷ`
3. Corregir: `w ← w + η·e·x`  y  `b ← b + η·e`

> Si `e = 0` no hay nada que corregir.
> Si `e = 1` el modelo subestimó (predijo 0 y era 1).
> Si `e = −1` el modelo sobreestimó (predijo 1 y era 0).
