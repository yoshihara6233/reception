# Ansible Playbooks

F86 で Hetzner VM の初期セットアップを冪等化。

## 用途
- 障害時の再構築 (30 分以内)
- 監視サーバ移行時の再現
- セキュリティパッチの一括適用

## 実行
```bash
cd infra/ansible
ansible-playbook -i inventory/hetzner playbooks/site.yml
```
