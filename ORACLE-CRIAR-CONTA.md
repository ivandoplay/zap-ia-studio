# Guia: Criar conta Oracle Cloud Always Free

## Resumo rápido

1. Criar conta no navegador (você faz)
2. Autenticar OCI CLI (eu faço)
3. Provisionar instância Always Free (eu faço via script)

---

## Passo 1: Criar conta Oracle Cloud (você faz no navegador)

### 1.1 Acesse o site

Abra no navegador: **https://www.oracle.com/cloud/free/**

### 1.2 Clique em "Start for free"

### 1.3 Preencha os dados

- **Nome completo**: Jefferson Ivan
- **Email**: jeffersonivan@zapia.local (ou seu email real)
- **País**: Brazil
- **Telefone**: +55 (86) 9xxx-xxxx

### 1.4 Confirmação de identidade

Oracle vai enviar:
- **Email** com link de confirmação
- **SMS** com código de verificação

Clique no link do email e digite o código do SMS.

### 1.5 Adicione método de pagamento

⚠️ **Importante**: Oracle pede cartão de crédito para verificação, mas **não cobra** na Always Free. É só para confirmar que você é uma pessoa real.

- Use qualquer cartão de crédito (não será cobrado)
- A taxa de verificação é de $1 (réplica) mas é devolvida automaticamente

### 1.6 Escolha a região

Escolha a região mais próxima do Brasil:

| Região | Código | Localização |
|---|---|---|
| US East Ashburn | `us-ashburn-1` | Virgínia, EUA |
| South America (São Paulo) | `sa-vinaupp-1` | São Paulo, Brasil |

**Recomendado**: `sa-vinaupp-1` (São Paulo) — mais próximo do Brasil.

### 1.7 Ative o Always Free

Após criar a conta:
1. Vá em **"My Account"** → **"Always Free"**
2. Clique em **"Start using Always Free"**
3. Confirme os recursos disponíveis:
   - 4 OCPU ARM (Ampere A1)
   - 24 GB RAM
   - 200 GB armazenamento
   - 10 TB network/mês

---

## Passo 2: Autenticar OCI CLI (eu faço)

Após você criar a conta:

### 2.1 Gerar chave API

Vá em **"My Account"** → **"API Keys"** → **"Generate API Key"**

Baixe o `.pem` e salve em: `~/.oci/oci_api_key.pem`

### 2.2 Gerar fingerprint da chave

```bash
openssl pkey -in ~/.oci/oci_api_key.pem -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}'
```

### 2.3 Configuar OCI CLI

Vou fazer isso automaticamente quando você me enviar:
- O `oci_api_key.pem` (conteúdo)
- O fingerprint
- O OCID do seu usuário (opcional — pode ser obtido via API)

O OCI CLI já está instalado nesta máquina (versão 3.68.1).

---

## Passo 3: Provisionar instância Always Free (eu faço via script)

Após autenticação, vou rodar:

```bash
./scripts/oracle-provision.sh ienvia-motor-cliente1
```

O script faz:
1. ✅ Chave SSH já gerada (~/.ssh/id_rsa)
2. ✅ Criar instância Always Free (Ampere A1, 4 OCPU, 24GB RAM)
3. ✅ Aguardar instância ficar RUNNING
4. ✅ Obter IP público
5. ✅ Instala Docker na VM
6. ✅ Clona repositório, configura .env, inicia motor via docker compose

---

## Após o provisionamento

- **Painel**: `http://<IP>:3000`
- **Healthcheck**: `http://<IP>:3000/health`
- **Login**: com seu usuário (ex: `jeffersonivan`)
- **WhatsApp**: QR Code na aba "Início & Conexão"

---

## Dúvidas?

Mande mensagem que eu ajudo com o processo.
