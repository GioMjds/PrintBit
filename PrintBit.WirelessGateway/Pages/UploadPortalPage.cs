using System.Net;

namespace PrintBit.WirelessGateway.Pages;

public static class UploadPortalPage
{
    public static string Render(string token, string contentRoot)
    {
        var safeToken = WebUtility.HtmlEncode(token);
        var portalRoot = Path.Combine(contentRoot, "Pages", "UploadPortal");
        var htmlPath = Path.Combine(portalRoot, "index.html");

        if (!File.Exists(htmlPath))
        {
            throw new FileNotFoundException("Upload portal HTML file not found.", htmlPath);
        }

        var template = File.ReadAllText(htmlPath);

        // Inject base href so relative asset URLs resolve under /upload/{token}/
        var assetBase = $"/upload/{WebUtility.UrlEncode(token)}/";
        if (template.Contains("<head>"))
        {
            template = template.Replace("<head>", $"<head>\n  <base href=\"{assetBase}\">");
        }

        // Replace token placeholder used inside app.js (const token = "{{token}}";)
        return template.Replace("{{token}}", safeToken);
    }
}
