# Craftpick Status

Moniteur HTTP/TCP léger en TypeScript, adapté à Raspberry Pi OS 64 bits et Node.js 20+.

## Développement

```bash
npm ci
export ADMIN_PASSWORD='un-secret-long-et-unique'
npm run dev
```

La page publique est disponible sur `http://localhost:3000` et l’administration sur
`http://localhost:3000/admin.html`.

## Installation sur Raspberry Pi

Installez Node.js 20 ou 22 LTS, puis copiez le projet dans `/opt/craftpick-status`.

```bash
cd /opt/craftpick-status
npm ci
npm run build
sudo useradd --system --home /var/lib/craftpick-status --shell /usr/sbin/nologin craftpick
sudo install -d -o craftpick -g craftpick /var/lib/craftpick-status
sudo install -m 600 -o root -g root .env.example /etc/craftpick-status.env
sudo install -m 644 deploy/craftpick-status.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now craftpick-status
```

Modifiez impérativement `ADMIN_PASSWORD` dans `/etc/craftpick-status.env` avant le
démarrage. Placez idéalement l’application derrière Caddy ou Nginx avec HTTPS.

Commandes utiles :

```bash
systemctl status craftpick-status
journalctl -u craftpick-status -f
curl http://127.0.0.1:3000/api/health
```

## Configuration

Les variables disponibles sont documentées dans `.env.example`. Les services, le
thème et le webhook sont persistés dans `data.json`, ou dans le chemin défini par
`DATA_FILE`. Le webhook n’est jamais exposé par l’API publique.
