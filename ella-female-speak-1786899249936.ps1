Add-Type -AssemblyName System.Speech
$bytes = [System.Convert]::FromBase64String('SSdtIGhlcmUgdG8gYXNzaXN0IHlvdSB3aXRoIGFueSBxdWVzdGlvbnMgb3IgY29uY2VybnMgeW91IG1heSBoYXZlLiBQbGVhc2UgZmVlbCBmcmVlIHRvIGFzayBtZSBhbnl0aGluZywgYW5kIEkgd2lsbCBkbyBteSBiZXN0IHRvIHByb3ZpZGUgYSBjbGVhciBhbmQgaW5mb3JtYXRpdmUgcmVzcG9uc2U=')
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Zira Desktop")
// Slightly slower rate for a calm, measured delivery. Range is -10..10 in SAPI.
$synth.Rate = -1
$synth.Volume = 100
$synth.Speak($text)
$synth.Dispose()