FROM node:20-slim

WORKDIR /app

# package.json과 lock 파일만 먼저 복사하여 종속성만 설치
COPY package*.json ./

# production 의존성만 설치 (devDependencies 제외)
RUN npm ci --omit=dev

# 애플리케이션 소스 복사
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]

