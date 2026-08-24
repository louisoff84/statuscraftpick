#!/bin/bash

# Couleurs pour l'affichage
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # Fin des couleurs

clear
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}       RAPPORT DE BENCHMARK SERVEUR         ${NC}"
echo -e "${CYAN}============================================${NC}"
echo -e "Date : $(date)\n"

# 1. Informations Système
echo -e "${GREEN}[+] 1. Informations Système${NC}"
echo "----------------------------------------"
echo -n "OS        : " && cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '"'
echo -n "CPU       : " && lscpu | grep "Model name" | sed 's/Model name:\s*//'
echo -n "Cores/Threads : " && nproc
echo -n "RAM Totale: " && free -h | awk '/Mem:/ {print $2}'
echo -n "Disque /  : " && df -h / | awk 'NR==2 {print $2}'
echo "----------------------------------------\n"

# 2. Test I/O Disque (Écriture / Lecture)
echo -e "${GREEN}[+] 2. Performances I/O Disque${NC}"
echo "----------------------------------------"
echo "Test d'écriture (1 Go)..."
DD_WRITE=$(dd if=/dev/zero of=test_perf_file bs=1M count=1024 conv=fdatasync 2>&1 | awk -F, '{print $3}')
echo "Vitesse d'écriture :$DD_WRITE"

echo "Test de lecture..."
DD_READ=$(dd if=test_perf_file of=/dev/null bs=1M count=1024 2>&1 | awk -F, '{print $3}')
echo "Vitesse de lecture :$DD_READ"

# Nettoyage du fichier temporaire
rm -f test_perf_file
echo "----------------------------------------\n"

# 3. Test CPU (OpenSSL)
echo -e "${GREEN}[+] 3. Test CPU (Chiffrement OpenSSL Multi-thread)${NC}"
echo "----------------------------------------"
if command -v openssl &> /dev/null; then
    openssl speed -seconds 3 -multi $(nproc) sha256 | grep -E "sign|verify|sha256"
else
    echo -e "${RED}OpenSSL non trouvé, test CPU alternatif...${NC}"
    time seq 1 500000000 > /dev/null
fi
echo "----------------------------------------\n"

# 4. Test RAM
echo -e "${GREEN}[+] 4. Test Mémoire RAM${NC}"
echo "----------------------------------------"
if command -v sysbench &> /dev/null; then
    sysbench memory --memory-block-size=1M --memory-total-size=2G run | grep -E "total size|ops/sec|transferred"
else
    echo "sysbench non installé (recommandé pour un test précis : apt install sysbench)."
    echo "Test rapide via la mémoire partagée (RAM disk)..."
    dd if=/dev/zero of=/dev/shm/test_ram bs=1M count=1024 conv=fdatasync status=none
    rm -f /dev/shm/test_ram
    echo "Test RAM (écriture tmpfs) terminé."
fi
echo "----------------------------------------\n"

# 5. Test Réseau (Téléchargement)
echo -e "${GREEN}[+] 5. Test de Bande Passante Réseau${NC}"
echo "----------------------------------------"
if command -v wget &> /dev/null; then
    echo "Téléchargement d'un fichier de test (100 Mo)..."
    wget -o /dev/null --inet4-only http://speedtest.tele2.net/100MB.zip -O temp_speed.zip
    rm -f temp_speed.zip
elif command -v curl &> /dev/null; then
    echo "Téléchargement via curl..."
    curl -s http://speedtest.tele2.net/100MB.zip -o /dev/null
else
    echo -e "${RED}Ni wget ni curl ne sont disponibles pour tester le réseau.${NC}"
fi
echo "----------------------------------------"
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}          BENCHMARK TERMINÉ                 ${NC}"
echo -e "${CYAN}============================================${NC}"
