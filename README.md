# Alétrain
Un HTML simple permettant de voyager de manière aléatoire en Suisse grâce à un tirage au sort du quai, du train et de l'arrêt de sortie. 

## Lancer avec Docker

```bash
docker build -t aletrain .
docker run --rm -p 4173:4173 aletrain
```

Puis ouvrir `http://localhost:4173`.
