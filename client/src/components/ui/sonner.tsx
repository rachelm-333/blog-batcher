import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <>
      <style>{`
        /* ── Brand lime toast styling ────────────────────────────── */
        [data-sonner-toaster] [data-sonner-toast] {
          background: #CCFF00 !important;
          color: #000000 !important;
          font-weight: 700 !important;
          border: none !important;
          border-radius: 10px !important;
          min-width: 320px !important;
          padding: 16px 20px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.22), 0 1px 4px rgba(0,0,0,0.12) !important;
        }
        /* Error variant: red left border */
        [data-sonner-toaster] [data-sonner-toast][data-type="error"] {
          border-left: 4px solid #e53e3e !important;
          border-radius: 10px !important;
          padding-left: 16px !important;
        }
        /* Keep icon colours readable */
        [data-sonner-toaster] [data-sonner-toast] [data-icon] svg {
          color: #000000 !important;
        }
        [data-sonner-toaster] [data-sonner-toast][data-type="error"] [data-icon] svg {
          color: #e53e3e !important;
        }
        /* Close button */
        [data-sonner-toaster] [data-sonner-toast] [data-close-button] {
          background: rgba(0,0,0,0.12) !important;
          border-color: transparent !important;
          color: #000000 !important;
        }
        /* Description text */
        [data-sonner-toaster] [data-sonner-toast] [data-description] {
          color: #222222 !important;
          font-weight: 500 !important;
        }
      `}</style>
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        position="bottom-right"
        {...props}
      />
    </>
  );
};

export { Toaster };
