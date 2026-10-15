## One-time: signing identity

TCC keys consent to the code signature. Ad-hoc signing (`codesign -s -`) has no stable identity, so consent never sticks and the prompt returns. Fix: a self-signed identity named **"Orca Patched Signing"** in the login keychain.

Check first: `security find-identity -v -p codesigning` , if it lists "Orca Patched Signing", skip to the deploy procedure.

To (re)create it programmatically:

```bash
cd "$(mktemp -d)"
cat > codesign-ext.cnf <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3_code
prompt = no
[dn]
CN = Orca Patched Signing
[v3_code]
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
basicConstraints = critical,CA:false
EOF
openssl req -x509 -newkey rsa:2048 -keyout orca-sign.key -out orca-sign.pem \
  -days 3650 -nodes -config codesign-ext.cnf
# Import PEM key + cert directly. Do NOT go via .p12: openssl 3 writes PBES2
# p12s that `security import` rejects with "MAC verification failed".
security import orca-sign.key -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign
security import orca-sign.pem -k ~/Library/Keychains/login.keychain-db
security add-trusted-cert -p codeSign -k ~/Library/Keychains/login.keychain-db orca-sign.pem
security find-identity -v -p codesigning   # must list "Orca Patched Signing" as valid
```

macOS may show one GUI password prompt for the trust step and one "codesign wants to access key" prompt on first sign , Jose clicks Always Allow. Each NEW identity (not each rebuild) costs one fresh round of TCC prompts; after that they persist.
