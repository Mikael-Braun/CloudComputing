# Ambiente de desenvolvimento: Firebase CLI + emuladores (Auth, Firestore, Hosting).
# Usa o projeto demo-robotaxi, por isso nunca toca na produção nem gasta quota.
#   docker build -t robotaxi-dev .
#   docker run --rm -p 4000:4000 -p 4400:4400 -p 4500:4500 -p 5000:5000 -p 8080:8080 -p 9099:9099 --name robotaxi robotaxi-dev
#   docker exec robotaxi npm run seed      (noutro terminal: contas e veículos de teste)
#   docker exec -e FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 robotaxi node --test tests/rules.test.js
#                                          (testes das regras no emulador que já está a correr)
FROM node:20-bookworm-slim

# O emulador do Firestore corre em Java 21.
COPY --from=eclipse-temurin:21-jre /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk PATH="/opt/java/openjdk/bin:${PATH}"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# Descarrega os emuladores já na imagem, em vez de em cada arranque.
RUN npx firebase setup:emulators:firestore && npx firebase setup:emulators:ui

COPY . .
# Dentro do contentor os emuladores têm de ouvir em 0.0.0.0 para o browser do anfitrião lhes chegar.
RUN node -e "const fs=require('fs'),c=JSON.parse(fs.readFileSync('firebase.json'));\
for(const k of ['firestore','auth','hosting','ui','hub','logging'])c.emulators[k]={...c.emulators[k],host:'0.0.0.0'};\
c.emulators.hub.port=4400;c.emulators.logging.port=4500;fs.writeFileSync('firebase.json',JSON.stringify(c,null,2))"

EXPOSE 4000 4400 4500 5000 8080 9099
CMD ["npm", "run", "serve"]
