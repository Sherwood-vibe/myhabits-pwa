use strict;
use IO::Socket::INET;

my $port = $ENV{PORT} || 8080;
my $root = '/Users/andriileshchov/Documents/Habit Link prototype/MyHabits-PWA';

my %mime = (
    'html' => 'text/html', 'json' => 'application/json',
    'js'   => 'application/javascript', 'css' => 'text/css',
    'png'  => 'image/png', 'jpg' => 'image/jpeg',
    'svg'  => 'image/svg+xml', 'ico' => 'image/x-icon',
);

my $server = IO::Socket::INET->new(
    LocalPort => $port, Type => SOCK_STREAM,
    Reuse => 1, Listen => 10,
) or die "Cannot start server on port $port: $!\n";

print "Serving on http://localhost:$port\n";

while (my $client = $server->accept()) {
    my $request = <$client>;
    next unless $request;
    my ($method, $path) = $request =~ /^(\w+)\s+(\S+)/;
    # consume headers
    while (<$client>) { last if /^\r?\n$/; }

    $path =~ s/\?.*//;
    $path = '/index.html' if $path eq '/';
    $path =~ s/\.\.//g;

    my $file = "$root$path";
    if (-f $file) {
        open my $fh, '<:raw', $file or next;
        my $data = do { local $/; <$fh> };
        close $fh;
        my ($ext) = $file =~ /\.(\w+)$/;
        my $ct = $mime{$ext || ''} || 'application/octet-stream';
        print $client "HTTP/1.1 200 OK\r\nContent-Type: $ct\r\nContent-Length: " . length($data) . "\r\nConnection: close\r\n\r\n$data";
    } else {
        my $msg = "Not Found";
        print $client "HTTP/1.1 404 Not Found\r\nContent-Length: " . length($msg) . "\r\nConnection: close\r\n\r\n$msg";
    }
    close $client;
}
