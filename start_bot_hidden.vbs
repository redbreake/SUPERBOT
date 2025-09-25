Set oShell = CreateObject("WScript.Shell")
oShell.Run "cmd /c npm start", 0, false
Set oShell = Nothing