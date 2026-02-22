using PrintBit.Application.DTOs;

namespace PrintBit.Application.Interfaces;

public interface IKioskNetworkService
{
    HotspotNetworkStatusDto GetHotspotStatus();
    PrinterNetworkValidationResult ValidatePrinterConnection();
}
