<?php
declare(strict_types=1);

$config = require __DIR__ . '/../config.php';

$token = (string)($_GET['token'] ?? '');
if (!hash_equals($config['admin_token'], $token)) {
    http_response_code(403);
    echo 'Forbidden. Append ?token=<your admin_token from config.php> to this URL.';
    exit;
}

try {
    $pdo = new PDO(
        sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $config['db']['host'], $config['db']['name']),
        $config['db']['user'],
        $config['db']['pass'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            // Without this, foreach-ing a PDOStatement directly (the CSV export
            // loop below) yields each column twice - once by name, once by
            // numeric index - since PDO::FETCH_BOTH is the default. That
            // duplicated every field in the exported CSV.
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo 'Database connection failed - check marketing/config.php.';
    exit;
}

if (($_GET['export'] ?? '') === 'csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="iam-intelligence-leads.csv"');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['ID', 'Name', 'Email', 'Company', 'Company Size', 'Phone', 'Message', 'IP', 'Submitted At (UTC)']);
    $stmt = $pdo->query('SELECT id, name, email, company, company_size, phone, message, ip_address, created_at FROM leads ORDER BY created_at DESC');
    foreach ($stmt as $row) {
        fputcsv($out, $row);
    }
    fclose($out);
    exit;
}

$leads = $pdo->query(
    'SELECT id, name, email, company, company_size, phone, message, created_at FROM leads ORDER BY created_at DESC LIMIT 500'
)->fetchAll(PDO::FETCH_ASSOC);

function h(?string $value): string {
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>IAM Intelligence — Demo Leads</title>
<meta name="robots" content="noindex,nofollow">
<style>
  body{margin:0;font-family:Inter,system-ui,sans-serif;background:#071321;color:#edf5ff;padding:24px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#71849a;font-size:13px;margin-bottom:20px}
  a.export{display:inline-block;margin-bottom:16px;color:#8fc0ff;text-decoration:none;font-size:13px;border:1px solid rgba(160,193,226,.25);padding:6px 12px;border-radius:6px}
  a.export:hover{background:rgba(60,132,211,.1)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid rgba(160,193,226,.12)}
  th{color:#71849a;text-transform:uppercase;font-size:10px;letter-spacing:.6px}
  tr:hover td{background:rgba(60,132,211,.06)}
  .empty{color:#71849a;padding:20px 0}
</style>
</head>
<body>
<h1>IAM Intelligence — Demo Leads</h1>
<div class="sub"><?php echo count($leads); ?> most recent (up to 500), newest first.</div>
<a class="export" href="?token=<?php echo urlencode($token); ?>&export=csv">Export CSV</a>
<?php if (!$leads): ?>
  <div class="empty">No leads captured yet.</div>
<?php else: ?>
<table>
  <thead><tr><th>Submitted</th><th>Name</th><th>Email</th><th>Company</th><th>Size</th><th>Phone</th><th>Message</th></tr></thead>
  <tbody>
  <?php foreach ($leads as $lead): ?>
    <tr>
      <td><?php echo h($lead['created_at']); ?></td>
      <td><?php echo h($lead['name']); ?></td>
      <td><?php echo h($lead['email']); ?></td>
      <td><?php echo h($lead['company']); ?></td>
      <td><?php echo h($lead['company_size']); ?></td>
      <td><?php echo h($lead['phone']); ?></td>
      <td><?php echo h($lead['message']); ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>
</body>
</html>
