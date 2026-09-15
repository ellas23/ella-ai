Add-Type -AssemblyName System.Speech
$bytes = [System.Convert]::FromBase64String('T2YgY291cnNlLCBJJ20gaGFwcHkgdG8gaGVscCB3aXRoIHlvdXIgc3VydmV5ISBQbGVhc2UgZ28gYWhlYWQgYW5kIGFzayB5b3VyIHF1ZXN0aW9ucywgYW5kIEknbGwgZG8gbXkgYmVzdCB0byBwcm92aWRlIHRob3JvdWdoIGFuZCBpbmZvcm1hdGl2ZSBhbnN3ZXJzLiBJJ20gaGVyZSB0byBoZWxwIGFuZCBzdXBwb3J0IHlvdSBpbiBhbnkgd2F5IEkgY2FuLCBkb24ndCBoZXNpdGF0ZSB0byBhc2suIExldCdzIGdldCBzdGFydGVkIQ==')
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Zira Desktop")
// Slightly slower, smoother rate for a calm and natural delivery.
$synth.Rate = -2
$synth.Volume = 95
$synth.Speak($text)
$synth.Dispose()