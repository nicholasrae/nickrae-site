# nickrae.net DNS Setup — GitHub Pages

## Login
1. Go to https://www.hover.com/signin
2. Sign in with your Hover account

## DNS Changes (Domain → DNS tab)

### Delete existing A record
- Remove: A record pointing to `97.74.42.79` (Hover parking page)

### Add GitHub Pages A records (all 4)
| Type | Host | Value |
|------|------|-------|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

### Add www CNAME
| Type | Host | Value |
|------|------|-------|
| CNAME | www | nicholasrae.github.io |

### Email DNS (SPF/DKIM/DMARC for nick@nickrae.net)
Check what Hover already has for MX records (they handle email). Add:
| Type | Host | Value |
|------|------|-------|
| TXT | @ | v=spf1 include:hover.com ~all |
| TXT | _dmarc | v=DMARC1; p=none; rua=mailto:nick@nickrae.net |

## After DNS Update
- Wait 15-60 minutes for propagation
- GitHub Pages HTTPS cert auto-provisions after DNS resolves
- Verify: `dig nickrae.net` should show 185.199.x.x IPs
- Site live at https://nickrae.net
