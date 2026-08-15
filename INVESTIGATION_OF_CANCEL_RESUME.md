# PrintBit Research Notes - Epson L5290 Cancel/Resume Investigation

## Objective

Determine whether the **physical Cancel** and **Resume** buttons on the Epson L5290 can be detected by the PrintBit kiosk software through the USB connection.

---

# Current Findings

## ✅ USB Connection Confirmed

The Epson L5290 is connected using:

- USB Type-A (Tablet/PC)
- USB Type-B (Printer)

This is a standard USB Printer Class connection.

---

## ✅ Bidirectional Communication Enabled

Windows Printer Properties:

- ✔ Enable bidirectional support

This allows Windows and Epson software to communicate with the printer beyond one-way printing.

---

## ✅ Epson Status Monitor 3 Installed

Confirmed:

- Status Monitor is installed.
- Monitoring Preferences are accessible.
- Background monitoring is active.

Available monitored events include:

- Error
- Communication Error
- Printer Selection Error
- Ink Low

---

## ✅ Paper-Out Test Successful

### Test

1. Print a test page.
2. Remove all paper.
3. Printer reports Paper Out.
4. Epson Status Monitor displays the Paper Out state.
5. Insert paper.
6. Press Resume on the printer.
7. Printing continues successfully.

### What This Proves

- Epson Status Monitor communicates with the printer.
- USB communication is bidirectional.
- Printer firmware handles the Resume process correctly.

---

# What Has NOT Been Proven

The current experiment **does not prove** that:

- Windows receives a "Resume Button Pressed" event.
- Windows receives a "Cancel Button Pressed" event.
- Epson Status Monitor exposes physical button presses.

Instead, it only proves that the **printer state changed**.

Example:

```
Paper Out
        ↓
Resume Button
        ↓
Printer Continues Printing
```

The firmware may simply continue internally without notifying Windows that the button itself was pressed.

---

# Current Hypotheses

## Hypothesis A (Desired)

```
Resume Button
        ↓
Printer Firmware
        ↓
USB Notification
        ↓
Windows Driver
        ↓
PrintBit
```

If true:

- PrintBit can detect Resume.
- PrintBit can detect Cancel.
- A Go implementation is possible.

---

## Hypothesis B (More Likely)

```
Resume Button
        ↓
Printer Firmware
        ↓
Continue Printing
```

No explicit USB notification is sent.

Windows only observes that printing resumes.

---

# Next Experiment

## Long Print Job

Print:

- 30 to 50 pages

Keep open:

- Windows Print Queue
- Epson Status Monitor

---

## Resume Test

When:

```
Paper Out
```

Observe:

- Does Windows Queue change?
- Does Status Monitor update?
- Does Resume generate any popup?
- Is there any visible Windows event?

---

## Cancel Test

During active printing:

Press:

```
Cancel
```

Observe:

- Does Windows Queue immediately remove the job?
- Does Status Monitor display "Cancelled"?
- Does a notification appear?
- Does the printer simply stop?

---

# Final Research Phase

If Epson reacts to Resume or Cancel:

Capture USB traffic using:

- USBPcap
- Wireshark

Capture during:

- Paper Out
- Resume
- Cancel

Research question:

> Does the Epson L5290 transmit USB packets when the physical Cancel or Resume buttons are pressed?

If yes:

- Reverse engineer the protocol.
- Implement a Go `EpsonStatusClient`.

If no:

- The firmware handles the buttons entirely internally.
- PrintBit cannot directly observe physical button presses through standard USB communication.

---

# Current Conclusion

## Confirmed

- USB communication exists.
- Bidirectional communication works.
- Epson Status Monitor communicates with the printer.
- Paper Out detection works.
- Resume successfully continues printing.

## Unknown

- Whether the Cancel button generates a USB event.
- Whether the Resume button generates a USB event.
- Whether Epson exposes those events to third-party applications.

These are now the primary research questions before implementing a Go-based hardware monitoring solution for PrintBit.