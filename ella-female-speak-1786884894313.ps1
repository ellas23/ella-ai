Add-Type -AssemblyName System.Speech
$bytes = [System.Convert]::FromBase64String('SGVsbG8hIEknbSBFbGxhLCBob3cgY2FuIEkgYXNzaXN0IHlvdSB0b2RheT8gUGxlYXNlIGdvIGFoZWFkIGFuZCBhc2sgeW91ciBxdWVzdGlvbiBvciBzaGFyZSB3aGF0IHlvdSB3b3VsZCB0byBrbm93LiBJJ2xsIGRvIG15IGJlc3QgdG8gcHJvdmlkZSBhIGNvbmNpc2UgYW5kIGNsZWFyIGFuc3dlciB3aGlsZSBtYWludGFpbmluZyBhIG5ldXRyYWwgdG9uZSBhbmQgd2FybXRoIGluIG15IHJlc3BvbnNlcw==')
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Zira Desktop")
$synth.Rate = 0
$synth.Volume = 100
$synth.Speak($text)
$synth.Dispose()