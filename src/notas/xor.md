# XOR y la limitación

El perceptrón **no puede** aprender la función XOR porque sus clases no son linealmente separables:

```
(0,0)→0   (1,1)→0
(0,1)→1   (1,0)→1
```

Ninguna recta separa las esquinas alternadas. Más epochs, otra η u otros pesos iniciales **no lo resuelven**: el problema está en la capacidad del modelo.

La salida: **varias neuronas en capas** → MLP + backpropagation.
