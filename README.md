# Espontâneo — MWO Music

Interface mobile-first para direção de equipes durante momentos de adoração.

## Rodar localmente

```bash
npm install
npm run dev
```

O projeto usa Supabase para sincronizar comandos entre celulares diferentes e mantém
`BroadcastChannel` como apoio entre abas do mesmo navegador.

## Configurar o Supabase

1. Crie `.env.local` com a URL e a Publishable Key do projeto.
2. No painel do Supabase, abra **SQL Editor**.
3. Cole e execute todo o conteúdo de `supabase/schema.sql`.
4. Reinicie `npm run dev`.

## Fluxos incluídos

- Entrada por nome e função (voz, instrumento ou ambos)
- Tela ao vivo dividida entre direção e letra/mensagem
- Painel do administrador
- Comandos por seção da música
- Direções rápidas personalizáveis
- Mensagens livres
- Troca de música
- Controle de permissão por integrante
- Layout responsivo para celular e desktop
