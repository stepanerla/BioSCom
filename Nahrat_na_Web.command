#!/bin/bash
cd "$(dirname "$0")"

echo "==========================================="
echo "   Nahrávání BioSCom na internet (Hosting) "
echo "==========================================="
echo ""
echo "Krok 1: Přihlášení do Googlu (Firebase)"
echo "Pokud se otevře prohlížeč, přihlas se pod účtem, na kterém máš BioSCom."
echo "Pokud už jsi přihlášený, rovnou budeme pokračovat."
echo ""
./firebase_bin login

echo ""
echo "Krok 2: Nahrávání souborů..."
./firebase_bin deploy

echo ""
echo "==========================================="
echo " HOTOVO! Tvá aplikace běží trvale na adrese:"
echo " https://bioscom-ca01a.web.app/ "
echo "==========================================="
echo ""
