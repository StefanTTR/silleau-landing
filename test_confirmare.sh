#!/bin/bash
cat > /tmp/test_booking.json << 'EOF'
{"canal":"email","email":"tataru.stefan11@gmail.com","prenume":"Stefan","medic":"dr. Ioana Marin","specialitate":"Stomatologie","serviciu":"Igienizare","data":"2026-04-18","data_iso":"2026-04-18","ora":"10:00","rechemare":"","programare_id":"3e471ac3-f3f2-4820-9b3a-e1bafa4d2e93","clinic_id":"00000000-0000-0000-0000-000000000001"}
EOF

curl -X POST "https://wpxflbwohowigaulhxhk.supabase.co/functions/v1/confirmare-booking" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndweGZsYndvaG93aWdhdWxoeGhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MjExNTQsImV4cCI6MjA5MDA5NzE1NH0.hWpLo3bwaRVZDwxNoU0JG774OXKOY40rkkGNVWGqi7Y" \
  -d @/tmp/test_booking.json
