<?php

declare(strict_types=1);

$dataDir = __DIR__ . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'polls';
$initialState = [
    'people' => ['Frauke', 'Dominik', 'Sascha', 'Erich'],
    'availability' => (object) [],
    'slots' => initial_slots(),
    'useTime' => true,
    'invitation' => '',
];

header('Content-Type: application/json; charset=utf-8');

function respond($payload, int $status = 200)
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function initial_slots(): array
{
    return array_map(
        fn ($index) => initial_slot($index),
        range(0, 9)
    );
}

function initial_slot(int $index): array
{
    $date = date('Y-m-d', strtotime('+' . ($index + 3) . ' days'));
    return [
        'id' => $date . 'T18:00',
        'date' => $date,
        'time' => '18:00',
        'order' => $index,
    ];
}

function normalize_slots($slots, array $fallback): array
{
    if (!is_array($slots)) {
        return $fallback;
    }

    $normalized = [];
    foreach (array_values($slots) as $index => $slot) {
        if (!is_array($slot)) {
            continue;
        }

        $id = is_string($slot['id'] ?? null) ? $slot['id'] : '';
        $date = is_string($slot['date'] ?? null) ? $slot['date'] : substr($id, 0, 10);
        $time = is_string($slot['time'] ?? null) ? $slot['time'] : substr($id, 11, 5);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !preg_match('/^(\d{2}:\d{2})?$/', $time)) {
            continue;
        }

        $normalized[] = [
            'id' => $time === '' ? $date : $date . 'T' . $time,
            'date' => $date,
            'time' => $time,
            'order' => is_int($slot['order'] ?? null) ? $slot['order'] : $index,
        ];
    }

    usort($normalized, fn ($a, $b) => $a['order'] <=> $b['order'] ?: strcmp($a['id'], $b['id']));
    return $normalized ?: $fallback;
}

function normalize_state($state, array $fallback): array
{
    if (!is_array($state)) {
        return $fallback;
    }

    $people = array_values(array_filter(
        array_map(
            fn ($person) => is_string($person) ? trim(preg_replace('/\s+/', ' ', $person)) : '',
            $state['people'] ?? []
        ),
        fn ($person) => $person !== ''
    ));
    $people = array_values(array_unique($people));
    $slots = normalize_slots($state['slots'] ?? null, $fallback['slots']);
    $useTime = is_bool($state['useTime'] ?? null) ? $state['useTime'] : count(array_filter($slots, fn ($slot) => $slot['time'] !== '')) > 0;
    $slotIds = array_column($slots, 'id');

    $availability = [];
    if (isset($state['availability']) && is_array($state['availability'])) {
        foreach ($state['availability'] as $person => $personSlots) {
            if (!is_string($person) || !in_array($person, $people, true) || !is_array($personSlots)) {
                continue;
            }

            $availability[$person] = array_values(array_unique(array_filter(
                array_map(fn ($slot) => is_string($slot) ? trim($slot) : '', $personSlots),
                fn ($slot) => $slot === 'none' || in_array($slot, $slotIds, true)
            )));
        }
    }

    return [
        'people' => $people ?: $fallback['people'],
        'availability' => (object) $availability,
        'slots' => $slots,
        'useTime' => $useTime,
        'invitation' => is_string($state['invitation'] ?? null) ? trim($state['invitation']) : ($fallback['invitation'] ?? ''),
    ];
}

function poll_id(): string
{
    $poll = $_GET['poll'] ?? 'default';
    if (!is_string($poll) || !preg_match('/^[\p{L}\p{N}_-]{1,80}$/u', $poll)) {
        respond(['error' => 'Ungueltige Termin-Instanz.'], 400);
    }

    return $poll;
}

function read_state(string $dataFile, array $fallback): array
{
    if (!is_file($dataFile)) {
        return $fallback;
    }

    $json = file_get_contents($dataFile);
    if ($json === false) {
        return $fallback;
    }

    return normalize_state(json_decode($json, true), $fallback);
}

function all_voted(array $state): bool
{
    $availability = (array) $state['availability'];
    return $state['people'] !== []
        && count(array_filter($state['people'], fn ($person) => !empty($availability[$person]))) === count($state['people']);
}

function send_mail(string $subject, string $body): bool
{
    $sent = @mail(
        'erich.brandl@gmail.com',
        $subject,
        $body,
        "From: vorstand@senioren-luebars.berlin\r\nContent-Type: text/plain; charset=utf-8",
        '-fvorstand@senioren-luebars.berlin'
    );
    @file_put_contents(
        __DIR__ . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'mail.log',
        date('c') . ' ' . ($sent ? 'OK' : 'FEHLER') . ' ' . $subject . "\n",
        FILE_APPEND
    );
    return $sent;
}

function notify_complete(string $pollId, array $state): void
{
    $total = count($state['people']);
    $host = $_SERVER['HTTP_HOST'] ?? 'senioren-luebars.berlin';
    $base = 'https://' . $host . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/terminfinder/api.php'), '/');
    $link = $pollId === 'default' ? $base . '/' : $base . '/' . $pollId;

    $title = $pollId === 'default' ? 'Terminfinder' : $pollId;
    $body = "Alle $total Teilnehmer haben abgestimmt ($title).\n\nZur Abstimmung: $link\n";
    send_mail("Terminfinder: Abstimmung \"$title\" ist komplett", $body);
}

function write_state(string $dataDir, string $dataFile, array $state): void
{
    if (!is_dir($dataDir) && !mkdir($dataDir, 0775, true) && !is_dir($dataDir)) {
        respond(['error' => 'Datenordner konnte nicht angelegt werden.'], 500);
    }

    $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false || file_put_contents($dataFile, $json, LOCK_EX) === false) {
        respond(['error' => 'Status konnte nicht gespeichert werden.'], 500);
    }
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$pollId = poll_id();
$dataFile = $dataDir . DIRECTORY_SEPARATOR . $pollId . '.json';

if ($method === 'GET') {
    if (isset($_GET['mailtest'])) {
        respond(['mailSent' => send_mail('Terminfinder Testmail', 'Testmail vom Terminfinder.')]);
    }
    respond(read_state($dataFile, $initialState));
}

if ($method === 'PUT') {
    $body = file_get_contents('php://input');
    $state = normalize_state(json_decode($body ?: '', true), $initialState);
    $wasComplete = all_voted(read_state($dataFile, $initialState));
    write_state($dataDir, $dataFile, $state);
    if (!$wasComplete && all_voted($state)) {
        notify_complete($pollId, $state);
    }
    respond($state);
}

respond(['error' => 'Methode nicht erlaubt.'], 405);
