// Valkama's toast helper: shows, removes and checks a Windows toast for one
// application identity. `server/ops/toast.py` compiles this file with the C#
// compiler that ships with Windows (.NET Framework 4, which also loads the
// WinRT types Windows PowerShell 7 cannot) into the user's Valkama directory,
// so no binary is committed and no SDK is needed. That compiler speaks C# 5:
// no string interpolation, no `?.`, no `nameof`.
//
//   valkama-toast.exe show   <payload> [--print-plan]
//   valkama-toast.exe remove <payload> [--print-plan]
//   valkama-toast.exe check  <payload> [--print-plan]
//
// <payload> is base64 of UTF-8 JSON, so nothing a store row holds can become an
// argument or reach a shell:
//   show   {"aumid", "tag", "group", "xml", "expires_at": "YYYY-MM-DDTHH:MM:SSZ" | null}
//   remove {"aumid", "tag", "group"}
//   check  {"aumid"}
// The toast markup arrives final and escaped; this program only loads it.
//
// --print-plan decodes and loads everything exactly as the real run does and
// prints what it would do as JSON, without showing, removing or reading
// anything from Windows. The tests use it.
//
// `check` prints {"setting": n}, `ToastNotifier.Setting` as a number: 0 is
// Enabled, 1 DisabledForApplication, 2 DisabledForUser, 3 DisabledByGroupPolicy,
// 4 DisabledByManifest. A refusal prints {"error": "..."} and exits 2 for input
// this program does not accept, 3 for a failure in Windows. `show` and `remove`
// run detached with nobody reading their output, so they also append one line
// to %TEMP%\valkama-alerts.log, shared with the server's own lines.

using System;
using System.Globalization;
using System.IO;
using System.Text;
using Windows.Data.Json;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;

static class ValkamaToast
{
    const string PlanSwitch = "--print-plan";
    const string ExpiryFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'";

    sealed class Refusal : Exception
    {
        public Refusal(string message) : base(message) { }
    }

    static int Main(string[] args)
    {
        bool plan = args.Length == 3 && args[2] == PlanSwitch;
        string op = args.Length > 0 ? args[0] : "";
        try
        {
            if (args.Length != 2 && !plan)
            {
                throw new Refusal("usage: valkama-toast.exe show|remove|check <payload> [--print-plan]");
            }
            JsonObject payload = Decode(args[1]);
            JsonObject answer;
            if (op == "show")
            {
                answer = Show(payload, plan);
            }
            else if (op == "remove")
            {
                answer = Remove(payload, plan);
            }
            else if (op == "check")
            {
                answer = Check(payload, plan);
            }
            else
            {
                throw new Refusal("unknown operation: " + op);
            }
            Print(answer);
            return 0;
        }
        catch (Refusal refusal)
        {
            return Fail(op, plan, refusal.Message, 2);
        }
        catch (Exception error)
        {
            return Fail(op, plan, error.GetType().Name + ": " + error.Message, 3);
        }
    }

    static JsonObject Decode(string argument)
    {
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(argument);
        }
        catch (FormatException)
        {
            throw new Refusal("the payload is not base64");
        }
        string text;
        try
        {
            text = new UTF8Encoding(false, true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            throw new Refusal("the payload is not UTF-8");
        }
        JsonObject payload;
        if (!JsonObject.TryParse(text, out payload))
        {
            throw new Refusal("the payload is not a JSON object");
        }
        return payload;
    }

    static string Text(JsonObject payload, string name)
    {
        IJsonValue value;
        if (!payload.TryGetValue(name, out value) || value.ValueType != JsonValueType.String)
        {
            throw new Refusal("the payload needs the text field " + name);
        }
        string text = value.GetString();
        if (text.Length == 0)
        {
            throw new Refusal("the payload's " + name + " is empty");
        }
        return text;
    }

    static DateTimeOffset? Expiry(JsonObject payload)
    {
        IJsonValue value;
        if (!payload.TryGetValue("expires_at", out value) || value.ValueType == JsonValueType.Null)
        {
            return null;
        }
        if (value.ValueType != JsonValueType.String)
        {
            throw new Refusal("expires_at must be text or null");
        }
        DateTimeOffset parsed;
        if (!DateTimeOffset.TryParseExact(
            value.GetString(),
            ExpiryFormat,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out parsed))
        {
            throw new Refusal("expires_at must read YYYY-MM-DDTHH:MM:SSZ");
        }
        return parsed;
    }

    static JsonObject Show(JsonObject payload, bool plan)
    {
        string aumid = Text(payload, "aumid");
        XmlDocument document = new XmlDocument();
        try
        {
            document.LoadXml(Text(payload, "xml"));
        }
        catch (Exception error)
        {
            throw new Refusal("the toast markup does not load: " + error.Message);
        }
        ToastNotification toast = new ToastNotification(document);
        toast.Tag = Text(payload, "tag");
        toast.Group = Text(payload, "group");
        DateTimeOffset? expiry = Expiry(payload);
        // Windows refuses an expiry already past, and a toast for a question
        // that has expired has nothing left to ask.
        bool expired = expiry.HasValue && expiry.Value <= DateTimeOffset.UtcNow;
        if (expiry.HasValue && !expired)
        {
            toast.ExpirationTime = expiry.Value;
        }

        // Read back from the toast, so the plan reports what Windows would be given.
        JsonObject answer = Answer("show", aumid, toast.Tag, toast.Group);
        DateTimeOffset? carried = toast.ExpirationTime;
        answer["expires_at"] = carried.HasValue
            ? JsonValue.CreateStringValue(carried.Value.UtcDateTime.ToString(ExpiryFormat, CultureInfo.InvariantCulture))
            : JsonValue.CreateNullValue();
        answer["expired"] = JsonValue.CreateBooleanValue(expired);
        if (plan)
        {
            XmlElement root = document.DocumentElement;
            answer["launch"] = JsonValue.CreateStringValue(root.GetAttribute("launch"));
            answer["activation"] = JsonValue.CreateStringValue(root.GetAttribute("activationType"));
            JsonArray texts = new JsonArray();
            foreach (IXmlNode node in document.GetElementsByTagName("text"))
            {
                texts.Add(JsonValue.CreateStringValue(node.InnerText));
            }
            answer["texts"] = texts;
            string logo = null;
            foreach (IXmlNode node in document.GetElementsByTagName("image"))
            {
                XmlElement image = (XmlElement)node;
                if (image.GetAttribute("placement") == "appLogoOverride")
                {
                    logo = image.GetAttribute("src");
                }
            }
            answer["logo"] = logo == null ? JsonValue.CreateNullValue() : JsonValue.CreateStringValue(logo);
            answer["shown"] = JsonValue.CreateBooleanValue(false);
            return answer;
        }
        if (!expired)
        {
            ToastNotificationManager.CreateToastNotifier(aumid).Show(toast);
        }
        answer["shown"] = JsonValue.CreateBooleanValue(!expired);
        Log(expired ? "show skipped, expired: " + toast.Tag : "shown: " + toast.Tag);
        return answer;
    }

    static JsonObject Remove(JsonObject payload, bool plan)
    {
        JsonObject answer = Answer(
            "remove", Text(payload, "aumid"), Text(payload, "tag"), Text(payload, "group"));
        if (!plan)
        {
            ToastNotificationManager.History.Remove(
                answer.GetNamedString("tag"), answer.GetNamedString("group"), answer.GetNamedString("aumid"));
            Log("removed: " + answer.GetNamedString("tag"));
        }
        return answer;
    }

    static JsonObject Check(JsonObject payload, bool plan)
    {
        string aumid = Text(payload, "aumid");
        JsonObject answer = new JsonObject();
        answer["op"] = JsonValue.CreateStringValue("check");
        answer["aumid"] = JsonValue.CreateStringValue(aumid);
        if (!plan)
        {
            // Read as a number: Windows PowerShell 5.1 printed this enum's name as
            // empty, and a number is what the caller maps anyway.
            int setting = (int)ToastNotificationManager.CreateToastNotifier(aumid).Setting;
            answer["setting"] = JsonValue.CreateNumberValue(setting);
        }
        return answer;
    }

    static JsonObject Answer(string op, string aumid, string tag, string group)
    {
        JsonObject answer = new JsonObject();
        answer["op"] = JsonValue.CreateStringValue(op);
        answer["aumid"] = JsonValue.CreateStringValue(aumid);
        answer["tag"] = JsonValue.CreateStringValue(tag);
        answer["group"] = JsonValue.CreateStringValue(group);
        return answer;
    }

    static int Fail(string op, bool plan, string message, int code)
    {
        JsonObject answer = new JsonObject();
        answer["error"] = JsonValue.CreateStringValue(message);
        Print(answer);
        if (!plan && op != "check")
        {
            Log(op + " failed: " + message);
        }
        return code;
    }

    static void Print(JsonObject answer)
    {
        // UTF-8 without the byte order mark .NET Framework would otherwise put
        // first, which a JSON reader on the other end refuses.
        StreamWriter output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        output.Write(answer.Stringify());
        output.Flush();
    }

    static void Log(string message)
    {
        try
        {
            string path = Path.Combine(Path.GetTempPath(), "valkama-alerts.log");
            string line = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture)
                + " helper " + message + Environment.NewLine;
            byte[] bytes = new UTF8Encoding(false).GetBytes(line);
            using (FileStream stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
            {
                stream.Write(bytes, 0, bytes.Length);
            }
        }
        catch (IOException)
        {
            // A line lost to a locked log is not worth failing the toast over.
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
